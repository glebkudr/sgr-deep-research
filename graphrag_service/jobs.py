from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from redis import Redis

from .config import get_settings


class JobStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    DONE = "DONE"
    ERROR = "ERROR"


@dataclass
class JobStats:
    total_files: int = 0
    processed_files: int = 0
    nodes: int = 0
    edges: int = 0
    vector_chunks: int = 0
    duration_sec: float = 0.0


@dataclass
class JobError:
    message: str
    path: Optional[str] = None


@dataclass
class JobState:
    job_id: str
    collection: str
    status: JobStatus = JobStatus.PENDING
    stats: JobStats = field(default_factory=JobStats)
    errors: List[JobError] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None

    def to_primitive(self) -> Dict[str, Any]:
        payload = asdict(self)
        payload["status"] = self.status.value
        payload["created_at"] = self.created_at.isoformat()
        payload["updated_at"] = self.updated_at.isoformat()
        payload["started_at"] = self.started_at.isoformat() if self.started_at else None
        payload["finished_at"] = self.finished_at.isoformat() if self.finished_at else None
        payload["errors"] = [asdict(err) for err in self.errors]
        payload["stats"] = asdict(self.stats)
        return payload

    @staticmethod
    def from_primitive(payload: Dict[str, Any]) -> "JobState":
        status = JobStatus(payload["status"])
        stats = JobStats(**payload.get("stats", {}))
        errors = [JobError(**err) for err in payload.get("errors", [])]

        parse_dt = lambda value: datetime.fromisoformat(value) if value else None

        return JobState(
            job_id=payload["job_id"],
            collection=payload["collection"],
            status=status,
            stats=stats,
            errors=errors,
            created_at=parse_dt(payload.get("created_at")) or datetime.utcnow(),
            updated_at=parse_dt(payload.get("updated_at")) or datetime.utcnow(),
            started_at=parse_dt(payload.get("started_at")),
            finished_at=parse_dt(payload.get("finished_at")),
        )


class JobStore:
    """Store and retrieve job states in Redis."""

    def __init__(self, redis_client: Optional[Redis] = None) -> None:
        self.redis = redis_client or get_settings_redis()
        self.prefix = get_settings().job_state_prefix

    def _key(self, job_id: str) -> str:
        return f"{self.prefix}:{job_id}"

    def save(self, state: JobState) -> None:
        state.updated_at = datetime.utcnow()
        self.redis.set(self._key(state.job_id), json.dumps(state.to_primitive()))

    def get(self, job_id: str) -> Optional[JobState]:
        raw = self.redis.get(self._key(job_id))
        if not raw:
            return None
        data = json.loads(raw)
        return JobState.from_primitive(data)

    def update(self, job_id: str, **updates: Any) -> JobState:
        state = self.get(job_id)
        if not state:
            raise KeyError(f"Job {job_id} not found.")

        for key, value in updates.items():
            if hasattr(state, key):
                setattr(state, key, value)

        if state.started_at and state.finished_at:
            state.stats.duration_sec = (state.finished_at - state.started_at).total_seconds()

        self.save(state)
        return state


def get_settings_redis() -> Redis:
    from .redis_client import get_redis_client

    return get_redis_client()


__all__ = ["JobStatus", "JobStats", "JobError", "JobState", "JobStore"]
