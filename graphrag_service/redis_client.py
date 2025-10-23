from __future__ import annotations

import redis

from .config import get_settings


def get_redis_client() -> redis.Redis:
    settings = get_settings()
    return redis.Redis.from_url(settings.redis_url, encoding="utf-8", decode_responses=True)
