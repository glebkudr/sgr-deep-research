from __future__ import annotations

import logging
import re
import shutil
from pathlib import Path
from typing import List
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from graphrag_indexer.loader import ALLOWED_EXTENSIONS
from graphrag_service.config import get_settings
from graphrag_service.jobs import JobState
from graphrag_service.queue import IndexJob

from .auth import require_token
from .dependencies import get_job_queue, get_job_store
from .retrieval import RetrievalResult, RetrievalService
from .schemas import (
    JobStateSchema,
    QARequest,
    QAResponse,
    UploadPathsRequest,
    UploadResponse,
)


logger = logging.getLogger(__name__)
COLLECTION_PATTERN = re.compile(r"^[A-Za-z0-9_\-]{1,100}$")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="GraphRAG API", version="0.1.0")

    if settings.api_allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.api_allowed_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    @app.get("/health", tags=["health"])
    async def healthcheck() -> JSONResponse:
        return JSONResponse({"status": "ok"})

    @app.post("/upload", response_model=UploadResponse, tags=["indexing"])
    async def upload_endpoint(
        request: Request,
        _: dict = Depends(require_token),
        job_store=Depends(get_job_store),
        job_queue=Depends(get_job_queue),
    ) -> UploadResponse:
        collection, saved_files = await _handle_upload(request, settings)
        if not saved_files:
            logger.error(
                "Upload rejected: no valid files. content_type=%s headers_keys=%s",
                request.headers.get("content-type", ""),
                list(request.headers.keys()),
            )
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No valid files were provided.")

        job_id = uuid4().hex
        workspace_dir = Path(settings.workspace_dir)
        raw_dir = workspace_dir / collection / job_id / "raw"
        raw_dir.mkdir(parents=True, exist_ok=True)

        for source_path in saved_files:
            # Preserve relative structure under temp dir when moving into raw_dir
            try:
                rel = source_path.relative_to(Path(settings.workspace_dir) / ".upload_tmp")
            except ValueError:
                # Fallback to filename if the file is not under temp dir (should not happen)
                rel = Path(source_path.name)
            target_path = raw_dir / rel
            target_path.parent.mkdir(parents=True, exist_ok=True)
            if target_path.exists():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Duplicate file path '{rel.as_posix()}' in upload.",
                )
            shutil.move(str(source_path), str(target_path))

        job_state = JobState(job_id=job_id, collection=collection)
        job_state.stats.total_files = len(saved_files)
        job_store.save(job_state)
        job_queue.enqueue(IndexJob(job_id=job_id, collection=collection, raw_path=str(raw_dir)))
        logger.info("Enqueued job %s for collection %s with %d files.", job_id, collection, len(saved_files))
        return UploadResponse(job_id=job_id)

    @app.get("/jobs/{job_id}", response_model=JobStateSchema, tags=["indexing"])
    async def job_status(
        job_id: str,
        _: dict = Depends(require_token),
        job_store=Depends(get_job_store),
    ) -> JobStateSchema:
        state = job_store.get(job_id)
        if not state:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
        return JobStateSchema.from_job_state(state)

    @app.post("/qa", response_model=QAResponse, tags=["qa"])
    async def qa_endpoint(
        payload: QARequest,
        _: dict = Depends(require_token),
    ) -> QAResponse:
        service = RetrievalService()
        try:
            result = service.answer(
                question=payload.question,
                collection=payload.collection,
                top_k=payload.top_k,
                max_hops=payload.max_hops,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        return _build_qa_response(result)

    return app


async def _handle_upload(request: Request, settings) -> tuple[str, List[Path]]:
    content_type = request.headers.get("content-type", "").lower()
    temp_dir = Path(settings.workspace_dir) / ".upload_tmp"
    temp_dir.mkdir(parents=True, exist_ok=True)

    if "multipart/form-data" in content_type:
        form = await request.form()
        collection = form.get("collection")
        if not isinstance(collection, str):
            logger.error("Upload failed: missing 'collection' in form.")
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Collection is required.")
        collection = _normalize_collection(collection)
        files: List[UploadFile] = []
        counts: List[tuple[str, int]] = []
        for field_name in list(form.keys()):
            items = form.getlist(field_name)  # type: ignore[arg-type]
            num_files = sum(1 for it in items if _is_upload_file(it))
            counts.append((field_name, num_files))
            for it in items:
                if _is_upload_file(it):
                    files.append(it)  # type: ignore[arg-type]
        logger.info(
            "Upload form parsed: content_type=%s, fields=%s, per_field_file_counts=%s, total_files=%d",
            request.headers.get("content-type", ""),
            list(form.keys()),
            counts,
            len(files),
        )
        return collection, await _save_upload_files(files, temp_dir)

    json_payload = await request.json()
    payload = UploadPathsRequest.model_validate(json_payload)
    collection = _normalize_collection(payload.collection)
    return collection, _copy_existing_files(payload.paths, temp_dir)


def _normalize_collection(value: str) -> str:
    value = value.strip()
    if not COLLECTION_PATTERN.match(value):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid collection name.")
    return value


async def _save_upload_files(files: List[UploadFile], temp_dir: Path) -> List[Path]:
    saved: List[Path] = []
    for upload in files:
        raw_name = upload.filename or "file"
        rel_path = _safe_relative_path(raw_name)
        ext = Path(rel_path).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            await upload.close()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Extension '{ext}' is not allowed.",
            )
        target_dir = temp_dir / Path(rel_path).parent
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / Path(rel_path).name
        if target.exists():
            await upload.close()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Duplicate file path '{rel_path}' in upload.",
            )
        content = await upload.read()
        target.write_bytes(content)
        await upload.close()
        saved.append(target)
    return saved


def _copy_existing_files(paths: List[str], temp_dir: Path) -> List[Path]:
    saved: List[Path] = []
    for raw_path in paths:
        source = Path(raw_path).expanduser()
        if not source.is_file():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Path '{raw_path}' is not a file.")
        ext = source.suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Extension '{ext}' is not allowed.",
            )
        target = _unique_target(temp_dir, source.name)
        shutil.copy2(source, target)
        saved.append(target)
    return saved


def _unique_target(base_dir: Path, filename: str) -> Path:
    candidate = base_dir / filename
    counter = 1
    stem = Path(filename).stem
    suffix = Path(filename).suffix
    while candidate.exists():
        candidate = base_dir / f"{stem}_{counter}{suffix}"
        counter += 1
    return candidate


def _safe_relative_path(name: str) -> str:
    # Normalize to forward slashes and strip drive letters / leading slashes
    sanitized = name.replace("\\", "/").lstrip("/")
    parts = [p for p in Path(sanitized).parts if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid relative path.")
    rel = Path(*parts)
    if rel.name == "":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file name.")
    return rel.as_posix()


def _is_upload_file(obj: object) -> bool:
    return hasattr(obj, "filename") and callable(getattr(obj, "read", None))


def _build_qa_response(result: RetrievalResult) -> QAResponse:
    return QAResponse(
        answer=result.answer,
        citations=result.citations,
        graph_paths=result.graph_paths,
        cypher_used=result.cypher_used,
        confidence=result.confidence,
    )


app = create_app()
