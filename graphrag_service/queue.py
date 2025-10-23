from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import Any, Dict, Optional

from redis import Redis

from .config import get_settings
from .redis_client import get_redis_client


@dataclass
class IndexJob:
    job_id: str
    collection: str
    raw_path: str

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, payload: str) -> "IndexJob":
        data: Dict[str, Any] = json.loads(payload)
        return cls(**data)


class JobQueue:
    def __init__(self, redis_client: Optional[Redis] = None) -> None:
        settings = get_settings()
        self.redis = redis_client or get_redis_client()
        self.queue_name = settings.index_queue_name

    def enqueue(self, job: IndexJob) -> None:
        self.redis.rpush(self.queue_name, job.to_json())

    def dequeue(self, timeout: int = 5) -> Optional[IndexJob]:
        item = self.redis.blpop(self.queue_name, timeout=timeout)
        if not item:
            return None
        _, payload = item
        return IndexJob.from_json(payload)
