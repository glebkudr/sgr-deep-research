from __future__ import annotations

import json
import logging
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile, status
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
    UploadInitResponse,
    UploadPartResponse,
    UploadPathsRequest,
    UploadResponse,
)


logger = logging.getLogger(__name__)
COLLECTION_PATTERN = re.compile(r"^[A-Za-z0-9_\-]{1,100}$")
SESSION_ID_PATTERN = re.compile(r"^[a-f0-9]{32}$")
SESSION_META_FILENAME = "meta.json"
SESSION_TMP_DIRNAME = "tmp"
SESSION_STATUS_OPEN = "open"
SESSION_STATUS_FINALIZING = "finalizing"
SESSION_STATUS_CLOSED = "closed"


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

    @app.post("/upload/init", response_model=UploadInitResponse, tags=["indexing"])
    async def upload_init(
        collection: str = Form(...),
        _: dict = Depends(require_token),
    ) -> UploadInitResponse:
        normalized_collection = _normalize_collection(collection)
        upload_id = uuid4().hex
        session_dir = _create_session_dir(upload_id, settings)
        tmp_dir = session_dir / SESSION_TMP_DIRNAME
        try:
            tmp_dir.mkdir(parents=True, exist_ok=False)
        except OSError as exc:
            logger.error("event=upload_session_tmp_error upload_id=%s dir=%s error=%s", upload_id, tmp_dir, exc)
            shutil.rmtree(session_dir, ignore_errors=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to prepare upload session.",
            ) from exc
        meta = {
            "upload_id": upload_id,
            "collection": normalized_collection,
            "status": SESSION_STATUS_OPEN,
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
            "segments": [],
            "files": [],
            "total_files": 0,
        }
        try:
            _write_session_meta(session_dir, meta)
        except HTTPException:
            shutil.rmtree(session_dir, ignore_errors=True)
            raise
        batch_size = settings.upload_session_batch_size
        logger.info(
            "event=upload_session_init upload_id=%s collection=%s batch_limit=%d",
            upload_id,
            normalized_collection,
            batch_size,
        )
        return UploadInitResponse(upload_id=upload_id, batch_size=batch_size)

    @app.post("/upload/part", response_model=UploadPartResponse, tags=["indexing"])
    async def upload_part(
        upload_id: str = Form(...),
        files: List[UploadFile] = File(...),
        _: dict = Depends(require_token),
    ) -> UploadPartResponse:
        session_dir = _resolve_session_dir(upload_id, settings)
        meta = _load_session_meta(session_dir)
        if meta["status"] != SESSION_STATUS_OPEN:
            logger.error(
                "event=upload_session_closed upload_id=%s status=%s",
                upload_id,
                meta["status"],
            )
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Upload session is closed.")
        if not files:
            logger.error("event=upload_part_empty upload_id=%s", upload_id)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No files were provided.")
        if len(files) > settings.upload_session_batch_size:
            logger.error(
                "event=upload_part_batch_limit upload_id=%s provided=%d limit=%d",
                upload_id,
                len(files),
                settings.upload_session_batch_size,
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Batch size exceeds limit of {settings.upload_session_batch_size} files.",
            )

        existing_paths = set(_ensure_list_of_strings(meta["files"], "files"))
        original_files = list(meta["files"])
        original_segments = list(meta["segments"])
        planned_entries: List[tuple[str, Path, UploadFile]] = []
        batch_paths: set[str] = set()
        tmp_dir = session_dir / SESSION_TMP_DIRNAME
        tmp_dir.mkdir(parents=True, exist_ok=True)

        for upload in files:
            raw_name = upload.filename
            if not raw_name:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File name is required.")
            rel_path = _safe_relative_path(raw_name)
            if rel_path in existing_paths or rel_path in batch_paths:
                await upload.close()
                logger.error("event=upload_part_duplicate upload_id=%s path=%s", upload_id, rel_path)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Duplicate file path '{rel_path}' in upload session.",
                )
            ext = Path(rel_path).suffix.lower()
            if ext not in ALLOWED_EXTENSIONS:
                await upload.close()
                logger.error("event=upload_part_extension_rejected upload_id=%s path=%s ext=%s", upload_id, rel_path, ext)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Extension '{ext}' is not allowed.",
                )
            target_path = tmp_dir / rel_path
            target_path.parent.mkdir(parents=True, exist_ok=True)
            if target_path.exists():
                await upload.close()
                logger.error("event=upload_part_target_exists upload_id=%s path=%s", upload_id, rel_path)
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"File '{rel_path}' already stored in session.",
                )
            planned_entries.append((rel_path, target_path, upload))
            batch_paths.add(rel_path)

        persisted: List[Path] = []
        try:
            for rel_path, target, upload in planned_entries:
                content = await upload.read()
                target.write_bytes(content)
                persisted.append(target)
        except (OSError, RuntimeError) as exc:
            for path in persisted:
                if path.exists():
                    path.unlink()
            logger.error("event=upload_part_io_error upload_id=%s error=%s", upload_id, exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to store uploaded files.",
            ) from exc
        finally:
            for upload in files:
                await upload.close()

        saved_count = len(planned_entries)
        new_relative_paths = [rel_path for rel_path, _, _ in planned_entries]
        meta["files"].extend(new_relative_paths)
        meta["segments"].append(saved_count)
        meta["total_files"] = len(meta["files"])
        try:
            _write_session_meta(session_dir, meta)
        except HTTPException:
            meta["files"] = original_files
            meta["segments"] = original_segments
            meta["total_files"] = len(original_files)
            for rel_path in new_relative_paths:
                stored = tmp_dir / rel_path
                try:
                    stored.unlink(missing_ok=True)
                except OSError as exc:
                    logger.error("event=upload_part_cleanup_failed upload_id=%s path=%s error=%s", upload_id, rel_path, exc)
            raise
        logger.info(
            "event=upload_session_part upload_id=%s saved=%d total_files=%d segments=%s",
            upload_id,
            saved_count,
            meta["total_files"],
            meta["segments"],
        )
        return UploadPartResponse(saved=saved_count)

    @app.post("/upload/complete", response_model=UploadResponse, tags=["indexing"])
    async def upload_complete(
        upload_id: str = Form(...),
        _: dict = Depends(require_token),
        job_store=Depends(get_job_store),
        job_queue=Depends(get_job_queue),
    ) -> UploadResponse:
        session_dir = _resolve_session_dir(upload_id, settings)
        meta = _load_session_meta(session_dir)
        if meta["status"] != SESSION_STATUS_OPEN:
            logger.error("event=upload_complete_invalid_status upload_id=%s status=%s", upload_id, meta["status"])
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Upload session is not open.")

        stored_paths = _ensure_list_of_strings(meta["files"], "files")
        if not stored_paths:
            logger.error("event=upload_complete_no_files upload_id=%s", upload_id)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload session has no files.")

        previous_status = meta["status"]
        meta["status"] = SESSION_STATUS_FINALIZING
        try:
            _write_session_meta(session_dir, meta)
        except HTTPException:
            meta["status"] = previous_status
            raise

        job_id = uuid4().hex
        collection = meta["collection"]
        workspace_dir = Path(settings.workspace_dir)
        raw_dir = workspace_dir / collection / job_id / "raw"
        raw_dir.mkdir(parents=True, exist_ok=True)

        tmp_dir = session_dir / SESSION_TMP_DIRNAME
        moved_count = 0
        for relative in stored_paths:
            source = tmp_dir / relative
            if not source.is_file():
                logger.error("event=upload_missing_temp_file upload_id=%s path=%s", upload_id, relative)
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Stored file '{relative}' is missing from session.",
                )
            target = raw_dir / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                logger.error("event=upload_target_exists upload_id=%s path=%s", upload_id, relative)
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Target path '{relative}' already exists.",
                )
            try:
                shutil.move(str(source), str(target))
            except OSError as exc:
                logger.error("event=upload_complete_move_failed upload_id=%s path=%s error=%s", upload_id, relative, exc)
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to move uploaded files into workspace.",
                ) from exc
            moved_count += 1

        if moved_count != len(stored_paths):
            logger.error(
                "event=upload_complete_mismatch upload_id=%s recorded=%d moved=%d",
                upload_id,
                len(stored_paths),
                moved_count,
            )
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Mismatch in moved files count.")

        meta["status"] = SESSION_STATUS_CLOSED
        meta["completed_at"] = datetime.utcnow().isoformat()
        meta["total_files"] = moved_count
        try:
            _write_session_meta(session_dir, meta)
        except HTTPException:
            meta["status"] = SESSION_STATUS_FINALIZING
            raise

        job_state = JobState(job_id=job_id, collection=collection)
        job_state.stats.total_files = moved_count
        job_state.stats.session_segments = list(meta["segments"])
        job_state.stats.session_batches = len(meta["segments"])
        job_state.stats.session_total_files = meta["total_files"]
        job_store.save(job_state)
        job_queue.enqueue(IndexJob(job_id=job_id, collection=collection, raw_path=str(raw_dir)))
        logger.info(
            "event=upload_session_completed upload_id=%s job_id=%s collection=%s batches=%d total_files=%d",
            upload_id,
            job_id,
            collection,
            job_state.stats.session_batches,
            moved_count,
        )

        try:
            shutil.rmtree(session_dir)
        except OSError as exc:
            logger.error("event=upload_session_cleanup_failed upload_id=%s error=%s", upload_id, exc)

        return UploadResponse(job_id=job_id)

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


def _session_root(settings) -> Path:
    root = Path(settings.workspace_dir) / settings.upload_session_dirname
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.error("event=upload_session_root_error root=%s error=%s", root, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Upload sessions are unavailable.",
        ) from exc
    return root


def _create_session_dir(upload_id: str, settings) -> Path:
    if not SESSION_ID_PATTERN.match(upload_id):
        logger.error("event=upload_session_invalid_id upload_id=%s", upload_id)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to generate upload session.")
    root = _session_root(settings)
    session_dir = root / upload_id
    try:
        session_dir.mkdir(parents=False, exist_ok=False)
    except FileExistsError:
        logger.error("event=upload_session_collision upload_id=%s", upload_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Upload session identifier collision.",
        )
    except OSError as exc:
        logger.error("event=upload_session_dir_error upload_id=%s dir=%s error=%s", upload_id, session_dir, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create upload session.",
        ) from exc
    return session_dir


def _resolve_session_dir(upload_id: str, settings) -> Path:
    if not SESSION_ID_PATTERN.match(upload_id):
        logger.error("event=upload_session_invalid_format upload_id=%s", upload_id)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid upload session id.")
    session_dir = _session_root(settings) / upload_id
    if not session_dir.is_dir():
        logger.error("event=upload_session_not_found upload_id=%s", upload_id)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found.")
    return session_dir


def _load_session_meta(session_dir: Path) -> Dict[str, Any]:
    meta_path = session_dir / SESSION_META_FILENAME
    if not meta_path.is_file():
        logger.error("event=upload_session_meta_missing session_dir=%s", session_dir)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found.")
    try:
        raw = meta_path.read_text(encoding="utf-8")
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.error("event=upload_session_meta_invalid_json session_dir=%s error=%s", session_dir, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Upload session metadata is corrupted.",
        ) from exc
    required_keys = {"upload_id", "collection", "status", "files", "segments", "total_files"}
    missing = required_keys.difference(data.keys())
    if missing:
        logger.error("event=upload_session_meta_missing_fields session_dir=%s missing=%s", session_dir, sorted(missing))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Upload session metadata is invalid.",
        )
    if str(data["upload_id"]) != session_dir.name:
        logger.error(
            "event=upload_session_meta_mismatch session_dir=%s recorded_id=%s",
            session_dir,
            data["upload_id"],
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Upload session metadata mismatch.",
        )
    if not isinstance(data["collection"], str) or not data["collection"]:
        logger.error("event=upload_session_meta_collection_invalid session_dir=%s", session_dir)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Upload session metadata has invalid collection.",
        )
    status_value = data["status"]
    if status_value not in {SESSION_STATUS_OPEN, SESSION_STATUS_FINALIZING, SESSION_STATUS_CLOSED}:
        logger.error("event=upload_session_meta_status_invalid session_dir=%s status=%s", session_dir, status_value)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Upload session metadata has invalid status.",
        )
    files = _ensure_list_of_strings(data["files"], "files")
    segments = _ensure_list_of_ints(data["segments"], "segments")
    total_files = data["total_files"]
    if not isinstance(total_files, int) or total_files < 0:
        logger.error("event=upload_session_meta_total_invalid session_dir=%s value=%s", session_dir, total_files)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Upload session metadata has invalid totals.",
        )
    if total_files != len(files):
        logger.error(
            "event=upload_session_meta_total_mismatch session_dir=%s recorded=%d actual=%d",
            session_dir,
            total_files,
            len(files),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Upload session metadata count mismatch.",
        )
    data["files"] = files
    data["segments"] = segments
    return data


def _write_session_meta(session_dir: Path, meta: Dict[str, Any]) -> None:
    meta_path = session_dir / SESSION_META_FILENAME
    meta["updated_at"] = datetime.utcnow().isoformat()
    try:
        meta_path.write_text(json.dumps(meta, ensure_ascii=True, indent=2), encoding="utf-8")
    except OSError as exc:
        logger.error("event=upload_session_meta_write_failed session_dir=%s error=%s", session_dir, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to persist upload session metadata.",
        ) from exc


def _ensure_list_of_strings(value: Any, field: str) -> List[str]:
    if not isinstance(value, list):
        logger.error("event=upload_session_meta_type_error field=%s type=%s", field, type(value))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Upload session metadata field '{field}' is invalid.",
        )
    result: List[str] = []
    for item in value:
        if not isinstance(item, str):
            logger.error("event=upload_session_meta_item_type_error field=%s item_type=%s", field, type(item))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Upload session metadata field '{field}' contains invalid entries.",
            )
        result.append(item)
    return result


def _ensure_list_of_ints(value: Any, field: str) -> List[int]:
    if not isinstance(value, list):
        logger.error("event=upload_session_meta_type_error field=%s type=%s", field, type(value))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Upload session metadata field '{field}' is invalid.",
        )
    result: List[int] = []
    for item in value:
        if not isinstance(item, int) or item < 0:
            logger.error("event=upload_session_meta_item_type_error field=%s item=%s", field, item)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Upload session metadata field '{field}' contains invalid entries.",
            )
        result.append(item)
    return result


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
