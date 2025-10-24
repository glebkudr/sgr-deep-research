from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration sourced from environment variables."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False)

    openai_api_key: str | None = None
    embedding_model: str = "text-embedding-3-large"

    neo4j_uri: str = "bolt://neo4j:7687"
    neo4j_username: str = "neo4j"
    neo4j_password: str = "neo4j"
    neo4j_database: str = "neo4j"
    neo4j_heap_size: str | None = None
    neo4j_pagecache_size: str | None = None

    redis_url: str = "redis://localhost:6379/0"

    jwt_secret: str | None = None

    workspace_dir: Path = Path("/workspace")
    indexes_dir: Path = Path("/indexes")

    api_host: str = "0.0.0.0"
    api_port: int = 8000
    frontend_port: int = 3000
    log_level: str = "INFO"

    next_public_api_url: str | None = None
    next_public_jwt: str | None = None
    api_allowed_origins: List[str] = []

    faiss_index_filename: str = "index.faiss"
    faiss_metadata_filename: str = "chunks.jsonl"

    index_queue_name: str = "graphrag:indexer:queue"
    job_state_prefix: str = "graphrag:indexer:jobs"

    max_embedding_batch: int = 64
    embedding_retry_attempts: int = 5
    embedding_retry_backoff: float = 2.0

    qa_model: str = "gpt-4o-mini"
    qa_temperature: float = 0.0
    qa_max_tokens: int = 800
    qa_default_top_k: int = 12
    qa_default_max_hops: int = 2
    qa_allowed_relationships: List[str] = [
        "CONTAINS",
        "BELONGS_TO",
        "HAS_MODULE",
        "HAS_ROUTINE",
        "DEFAULT_FORM",
        "HAS_FORM",
        "HAS_CONTROL",
        "HANDLES_EVENT",
        "BINDS",
        "BINDS_TO_COMMAND",
        "COMMAND_OF",
        "HAS_LAYOUT",
        "LAYOUT_OF",
        "DEFINES_ATTRIBUTE",
        "HAS_TABULAR_PART",
        "HAS_RESOURCE",
        "HAS_DIMENSION",
        "USES_TYPE",
        "REFERENCES",
        "USES_MODULE",
        "READS_FROM",
        "WRITES_TO",
        "MAKES_MOVEMENTS_IN",
        "JOURNALED_IN",
        "HAS_ENUM_VALUE",
        "HAS_PREDEFINED",
        "HAS_HTTP_SERVICE",
        "HAS_URL_TEMPLATE",
        "HAS_URL_METHOD",
        "ROLE_HAS_ACCESS_TO",
        "GRANTS",
        "PERMITS",
        "SUBSCRIBES_TO",
        "HAS_EVENT_SOURCE",
        "CALLS",
        "OWNED_BY",
        "RESOLVES_TO",
        "PART_OF_DOCUMENT",
        "PART_OF_CHUNK",
    ]
    graph_path_limit: int = 25

@lru_cache
def get_settings() -> Settings:
    return Settings()
