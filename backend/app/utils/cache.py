"""Lightweight Redis cache for hot read endpoints.

Usage:
    @cached("stats", ttl=60)
    async def get_stats(): ...

If Redis is down we gracefully fall through to the wrapped function — this
is read-only caching, never critical path.
"""
from __future__ import annotations
import json
import functools
import logging
from typing import Any, Awaitable, Callable, TypeVar

import redis.asyncio as aioredis

from app.config import settings

logger = logging.getLogger(__name__)

T = TypeVar("T")

_redis: aioredis.Redis | None = None


def _client() -> aioredis.Redis | None:
    global _redis
    if _redis is None:
        try:
            _redis = aioredis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=1,
            )
        except Exception as e:
            logger.warning("Redis cache init failed: %s", e)
            _redis = None
    return _redis


def cached(key: str, ttl: int = 60):
    """Decorator: cache the async function's return value in Redis for ``ttl`` seconds.

    ``key`` is prepended with ``batchchef:cache:`` so keys are easy to scan
    / clear (``KEYS batchchef:cache:*`` in redis-cli).
    """
    full_key = f"batchchef:cache:{key}"

    def decorator(fn: Callable[..., Awaitable[T]]) -> Callable[..., Awaitable[T]]:
        @functools.wraps(fn)
        async def wrapper(*args, **kwargs) -> T:
            r = _client()
            if r is not None:
                try:
                    hit = await r.get(full_key)
                    if hit is not None:
                        return json.loads(hit)
                except Exception:
                    pass  # cache miss on error, fall through

            value = await fn(*args, **kwargs)

            if r is not None:
                try:
                    await r.setex(full_key, ttl, json.dumps(value, default=str))
                except Exception as e:
                    logger.debug("cache write failed: %s", e)
            return value

        return wrapper

    return decorator


async def invalidate(pattern: str = "*") -> int:
    """Delete cache entries matching ``batchchef:cache:<pattern>``. Returns
    the count of evicted keys."""
    r = _client()
    if r is None:
        return 0
    try:
        keys = await r.keys(f"batchchef:cache:{pattern}")
        if keys:
            return await r.delete(*keys)
    except Exception as e:
        logger.debug("cache invalidate failed: %s", e)
    return 0
