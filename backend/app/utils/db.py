"""DB helpers — retry-on-locked, safe commit, session helpers.

WAL + ``busy_timeout=5000`` already gives us 5 seconds of SQLite-level
retry on locked. This module adds a Python-level retry loop on top for
the edge case where the busy_timeout expires (multi-worker heavy load).

Use ``await commit_with_retry(db)`` instead of ``await db.commit()`` on
hot-path writes (map_prices, bulk imports).
"""
from __future__ import annotations
import asyncio
import logging
import random

from sqlalchemy.exc import OperationalError

logger = logging.getLogger(__name__)


async def commit_with_retry(
    db,
    *,
    attempts: int = 4,
    base_delay: float = 0.1,
    max_delay: float = 1.5,
) -> None:
    """Commit the session, retrying on transient SQLite lock errors.

    Total max wait ≈ 3.5s (0.1+0.2+0.4+0.8 with jitter). Raises the last
    OperationalError if all attempts fail.
    """
    last: Exception | None = None
    delay = base_delay
    for i in range(attempts):
        try:
            await db.commit()
            return
        except OperationalError as e:
            msg = str(e).lower()
            if "locked" not in msg and "busy" not in msg:
                raise  # not a retryable condition
            last = e
            if i == attempts - 1:
                break
            sleep_for = random.uniform(0, min(delay, max_delay))
            logger.debug("commit retry %d/%d after %.2fs (%s)", i + 1, attempts, sleep_for, msg[:60])
            await asyncio.sleep(sleep_for)
            delay *= 2
            # Roll back the failed state before retrying
            try:
                await db.rollback()
            except Exception:
                pass
    if last:
        raise last
