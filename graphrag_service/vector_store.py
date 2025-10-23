from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Sequence

import faiss
import numpy as np

from .config import get_settings


@dataclass
class VectorHit:
    chunk_id: str
    score: float
    metadata: dict


class FaissVectorStore:
    """Manage FAISS indices with metadata sidecars."""

    def __init__(self, collection: str, base_dir: Path | None = None) -> None:
        settings = get_settings()
        self.collection = collection
        self.base_dir = base_dir or settings.indexes_dir / collection / "faiss"
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.index_path = self.base_dir / settings.faiss_index_filename
        self.metadata_path = self.base_dir / settings.faiss_metadata_filename
        self.index: faiss.Index | None = None
        self.metadata: dict[str, dict] = {}
        self._ids: list[str] = []

    def build(self, embeddings: np.ndarray, ids: Sequence[str]) -> None:
        if embeddings.size == 0:
            raise ValueError("No embeddings provided to build FAISS index.")

        dim = embeddings.shape[1]
        index = faiss.IndexFlatIP(dim)

        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        normalized = embeddings / norms

        index.add(normalized.astype(np.float32))
        self.index = index
        self._ids = list(ids)

    def set_metadata(self, rows: Iterable[dict]) -> None:
        self.metadata = {row["chunk_id"]: row for row in rows}

    def save(self) -> None:
        if not self.index:
            raise RuntimeError("Index has not been built yet.")
        faiss.write_index(self.index, str(self.index_path))
        with self.metadata_path.open("w", encoding="utf-8") as fh:
            for chunk_id in self._ids:
                payload = self.metadata.get(chunk_id, {})
                payload.setdefault("chunk_id", chunk_id)
                fh.write(json.dumps(payload, ensure_ascii=False) + "\n")

    def load(self) -> None:
        if not self.index_path.exists():
            raise FileNotFoundError(f"FAISS index not found at {self.index_path}")
        self.index = faiss.read_index(str(self.index_path))
        self.metadata = {}
        with self.metadata_path.open("r", encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                row = json.loads(line)
                chunk_id = row["chunk_id"]
                self.metadata[chunk_id] = row
        self._ids = list(self.metadata.keys())

    def query(self, embedding: np.ndarray, top_k: int = 10) -> List[VectorHit]:
        if not self.index or not hasattr(self, "_ids"):
            raise RuntimeError("Index is not loaded.")

        embedding = embedding.astype(np.float32)
        norm = np.linalg.norm(embedding)
        if norm != 0:
            embedding = embedding / norm
        scores, indices = self.index.search(np.expand_dims(embedding, axis=0), top_k)
        result: List[VectorHit] = []

        for score, idx in zip(scores[0], indices[0]):
            if idx == -1 or idx >= len(self._ids):
                continue
            chunk_id = self._ids[idx]
            metadata = self.metadata.get(chunk_id, {})
            result.append(VectorHit(chunk_id=chunk_id, score=float(score), metadata=metadata))

        return result


__all__ = ["FaissVectorStore", "VectorHit"]
