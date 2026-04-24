"""Redis-backed mutex for Celery tasks.

Why we need this: we saw ``job #78`` get picked up by TWO workers
simultaneously after a restart because ``task_acks_late=True`` left the
task in the broker's unacked set while worker1 was still processing it
— worker2 then grabbed the same message.

The fix — besides increasing ``visibility_timeout`` — is to wrap tasks
that must be single-instance in a Redis lock keyed on the job_id. Only
one holder at a time, auto-expires if the worker crashes.

Usage:
    with redis_lock(f"import:{job_id}", ttl=3600*12) as acquired:
        if not acquired:
            logger.warning("already running, skipping duplicate")
            return
        # ... do the work ...
"""
from __future__ import annotations
import contextlib
import logging
import time
import uuid

import redis

from app.config import settings

logger = logging.getLogger(__name__)

_UNLOCK_LUA = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
else
    return 0
end
"""


@contextlib.contextmanager
def redis_lock(key: str, ttl: int = 3600):
    """Context manager that acquires a Redis lock, yields True on success.

    Uses the standard SET NX EX pattern + a per-instance unlock token so
    one worker can't accidentally release another's lock (e.g. if the
    first timed out and a second acquired a fresh lock).

    Yields False (without raising) when the lock is already held — caller
    decides whether that's a fatal error or a silent no-op.
    """
    full_key = f"batchchef:lock:{key}"
    token = str(uuid.uuid4())

    try:
        r = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=2)
        # SET key value NX EX ttl — atomic "set if not exists" with TTL
        acquired = bool(r.set(full_key, token, nx=True, ex=ttl))
    except Exception as e:
        # Redis down — degrade to "always acquired" so we don't block the
        # app on lock infrastructure being degraded. The worst case is
        # reverting to the pre-lock behaviour, not blocking everything.
        logger.warning("redis_lock(%s) init failed: %s — granting anyway", key, e)
        yield True
        return

    try:
        yield acquired
    finally:
        if acquired:
            try:
                r.eval(_UNLOCK_LUA, 1, full_key, token)
            except Exception as e:
                logger.warning("redis_lock(%s) release failed: %s", key, e)
