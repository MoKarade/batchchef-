"""Transient-error retry helpers.

SQLite under concurrent load occasionally raises ``OperationalError:
database is locked`` even with WAL + busy_timeout. These helpers wrap
a coroutine/callable with exponential backoff so the caller doesn't
have to.

Why not tenacity: it's a fine library but adds a heavy import and its
decorator interacts awkwardly with SQLAlchemy async sessions. A 20-line
helper is plenty.
"""
from __future__ import annotations
import asyncio
import logging
import random
from functools import wraps
from typing import Awaitable, Callable, TypeVar, ParamSpec

from sqlalchemy.exc import OperationalError, DBAPIError

logger = logging.getLogger(__name__)

P = ParamSpec("P")
R = TypeVar("R")

# Errors we consider worth retrying. Anything not in this tuple propagates
# immediately (e.g. IntegrityError is a permanent schema violation).
_RETRYABLE = (OperationalError, DBAPIError)


def _is_retryable(exc: Exception) -> bool:
    """True if the exception is a SQLite "try again later" flavour."""
    if not isinstance(exc, _RETRYABLE):
        return False
    msg = str(exc).lower()
    return (
        "database is locked" in msg
        or "database is busy" in msg
        or "cannot start a transaction" in msg
        or "disk i/o error" in msg
    )


def retry_on_transient(
    *,
    attempts: int = 5,
    base_delay: float = 0.05,
    max_delay: float = 2.0,
):
    """Async decorator: retry an awaitable on SQLite transient errors.

    Uses exponential backoff with full jitter (Amazon's recipe). At default
    settings, max total wait is ~5 s for 5 attempts, which matches our
    ``busy_timeout=5000`` pragma.
    """

    def decorator(fn: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
        @wraps(fn)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            delay = base_delay
            last_exc: Exception | None = None
            for i in range(attempts):
                try:
                    return await fn(*args, **kwargs)
                except Exception as e:
                    if not _is_retryable(e) or i == attempts - 1:
                        raise
                    last_exc = e
                    sleep_for = random.uniform(0, min(delay, max_delay))
                    logger.info(
                        "Transient DB error on %s (attempt %d/%d): %s — retrying in %.2fs",
                        fn.__name__, i + 1, attempts, str(e)[:80], sleep_for,
                    )
                    await asyncio.sleep(sleep_for)
                    delay *= 2
            # Unreachable — loop always raises or returns
            raise last_exc or RuntimeError("retry_on_transient exhausted")

        return wrapper

    return decorator
