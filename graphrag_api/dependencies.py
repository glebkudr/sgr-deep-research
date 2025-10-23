from __future__ import annotations

from functools import lru_cache

from graphrag_service.jobs import JobStore
from graphrag_service.queue import JobQueue


@lru_cache
def get_job_store() -> JobStore:
    return JobStore()


@lru_cache
def get_job_queue() -> JobQueue:
    return JobQueue()
