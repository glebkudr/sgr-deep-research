from __future__ import annotations

import time
from typing import Iterable, List, Sequence

import numpy as np
from openai import OpenAI, OpenAIError

from .config import get_settings


class OpenAIEmbeddingClient:
    """Wrapper around OpenAI embedding API with batching and retries."""

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured.")
        self.client = OpenAI(api_key=settings.openai_api_key)
        self.model = settings.embedding_model
        self.batch_size = settings.max_embedding_batch
        self.max_attempts = settings.embedding_retry_attempts
        self.backoff = settings.embedding_retry_backoff

    def embed_texts(self, texts: Sequence[str]) -> np.ndarray:
        embeddings: List[np.ndarray] = []
        for batch_vectors in self.embed_texts_iter(texts):
            embeddings.append(batch_vectors)
        if not embeddings:
            return np.zeros((0, 0), dtype=np.float32)
        return np.vstack(embeddings).astype(np.float32)

    def embed_texts_iter(self, texts: Sequence[str]) -> Iterable[np.ndarray]:
        """Yield embeddings per batch as ndarrays with shape (batch_size, dim)."""
        if not texts:
            return
        for batch_start in range(0, len(texts), self.batch_size):
            batch = list(texts[batch_start : batch_start + self.batch_size])
            vectors = self._embed_batch(batch)
            if vectors:
                yield np.vstack(vectors).astype(np.float32)

    def _embed_batch(self, batch: Sequence[str]) -> List[np.ndarray]:
        attempt = 0
        while True:
            attempt += 1
            try:
                response = self.client.embeddings.create(model=self.model, input=batch)
                vectors = [np.array(item.embedding, dtype=np.float32) for item in response.data]
                return vectors
            except OpenAIError as exc:
                if attempt >= self.max_attempts:
                    raise
                sleep_for = self.backoff * attempt
                time.sleep(sleep_for)

