"""In-process ring buffer that captures the last N unhandled exceptions.

Accessible via ``GET /api/admin/errors`` so you can post-mortem issues
without having to grep through 3 different PowerShell windows.

Populated by the global exception handler in ``app.main``. Entries expire
by ring eviction — oldest gets replaced when the buffer fills.

Not a Sentry replacement — just "what went wrong in the last hour?" at a
glance. For anything more serious, plug in real error tracking.
"""
from __future__ import annotations
import threading
import traceback
from collections import deque
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any

MAX_ENTRIES = 200


@dataclass
class ErrorEntry:
    timestamp: str
    request_id: str | None
    method: str | None
    path: str | None
    exception_type: str
    exception_message: str
    traceback: str

    def asdict(self) -> dict[str, Any]:
        return asdict(self)


_buffer: deque[ErrorEntry] = deque(maxlen=MAX_ENTRIES)
_lock = threading.Lock()


def record_exception(
    exc: BaseException,
    *,
    request_id: str | None = None,
    method: str | None = None,
    path: str | None = None,
) -> None:
    """Append an entry to the ring. Called from the global FastAPI
    exception handler — also safe to call from task code.
    """
    tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    entry = ErrorEntry(
        timestamp=datetime.now(timezone.utc).isoformat(),
        request_id=request_id,
        method=method,
        path=path,
        exception_type=type(exc).__name__,
        exception_message=str(exc)[:400],
        traceback=tb[-4000:],  # tail the stack — head is usually uvicorn plumbing
    )
    with _lock:
        _buffer.append(entry)


def snapshot(limit: int = 50) -> list[dict]:
    """Return the most recent ``limit`` entries (newest first)."""
    with _lock:
        return [e.asdict() for e in list(_buffer)[-limit:]][::-1]


def clear() -> int:
    """Wipe the buffer. Returns count cleared."""
    with _lock:
        n = len(_buffer)
        _buffer.clear()
    return n
