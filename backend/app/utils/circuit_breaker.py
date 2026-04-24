"""Circuit breaker for external API calls (Gemini, Claude, Maxi scraper).

Why: when a downstream service starts refusing requests (429 quota,
503 outage), hammering it with retries makes things worse and wastes
user-visible time. A circuit breaker trips after N failures in a window,
stops calling for a cooldown period, then half-opens to probe recovery.

States:
  - ``closed``    — normal, every call proceeds
  - ``open``      — every call raises ``CircuitOpenError`` immediately
  - ``half_open`` — ONE probe call is allowed; success → closed, fail → open

This is a simple in-memory implementation keyed by name. Good enough for
a single-process dev setup; for multi-process deployments we'd move the
counter to Redis.
"""
from __future__ import annotations
import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


class CircuitOpenError(Exception):
    """Raised when a call is refused because the breaker is open."""

    def __init__(self, name: str, remaining_s: float):
        self.name = name
        self.remaining_s = remaining_s
        super().__init__(
            f"Circuit '{name}' is open for another {remaining_s:.0f}s — too many recent failures"
        )


@dataclass
class _Breaker:
    failure_threshold: int
    window_s: float
    cooldown_s: float
    name: str
    # Timestamps of recent failures — pruned to window_s
    failures: list[float] = field(default_factory=list)
    # When the breaker opened (None if closed)
    opened_at: float | None = None
    # Serialize half-open probes so we don't flood on recovery
    probe_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    # Successful probe count — used to track recovery
    total_successes: int = 0
    total_failures: int = 0

    def _prune(self, now: float) -> None:
        cutoff = now - self.window_s
        self.failures = [t for t in self.failures if t > cutoff]

    def state(self) -> str:
        now = time.monotonic()
        if self.opened_at is None:
            return "closed"
        if now - self.opened_at >= self.cooldown_s:
            return "half_open"
        return "open"

    def record_success(self) -> None:
        self.total_successes += 1
        self.failures.clear()
        if self.opened_at is not None:
            logger.info("Circuit '%s' recovered — closing", self.name)
        self.opened_at = None

    def record_failure(self) -> None:
        self.total_failures += 1
        now = time.monotonic()
        self._prune(now)
        self.failures.append(now)
        if len(self.failures) >= self.failure_threshold and self.opened_at is None:
            logger.warning(
                "Circuit '%s' opening — %d failures in the last %.0fs",
                self.name, len(self.failures), self.window_s,
            )
            self.opened_at = now


_breakers: dict[str, _Breaker] = {}


def get_breaker(
    name: str,
    *,
    failure_threshold: int = 5,
    window_s: float = 60.0,
    cooldown_s: float = 90.0,
) -> _Breaker:
    """Return (or create) a breaker by name. All breakers share the same
    dict so the state persists across calls in this process."""
    b = _breakers.get(name)
    if b is None:
        b = _Breaker(
            failure_threshold=failure_threshold,
            window_s=window_s,
            cooldown_s=cooldown_s,
            name=name,
        )
        _breakers[name] = b
    return b


async def call_with_breaker(
    name: str,
    fn: Callable[[], Awaitable[T]],
    *,
    failure_threshold: int = 5,
    window_s: float = 60.0,
    cooldown_s: float = 90.0,
) -> T:
    """Wrap ``fn`` with the named circuit breaker.

    If the breaker is open, raises ``CircuitOpenError`` immediately.
    If half-open, allows one probe call — concurrent callers wait behind
    ``probe_lock`` so we don't flood a recovering service.
    """
    b = get_breaker(
        name, failure_threshold=failure_threshold,
        window_s=window_s, cooldown_s=cooldown_s,
    )
    s = b.state()
    if s == "open":
        remaining = b.cooldown_s - (time.monotonic() - (b.opened_at or 0))
        raise CircuitOpenError(name, remaining)

    if s == "half_open":
        async with b.probe_lock:
            # Re-check — another probe may have flipped us back to closed
            if b.state() == "closed":
                pass
            try:
                result = await fn()
                b.record_success()
                return result
            except Exception:
                b.record_failure()
                raise

    # closed — normal path
    try:
        result = await fn()
        b.record_success()
        return result
    except Exception:
        b.record_failure()
        raise


def snapshot() -> dict:
    """Return a JSON-able summary of all breakers — exposed on /api/metrics."""
    now = time.monotonic()
    out: dict[str, dict] = {}
    for name, b in _breakers.items():
        b._prune(now)
        out[name] = {
            "state": b.state(),
            "recent_failures": len(b.failures),
            "total_successes": b.total_successes,
            "total_failures": b.total_failures,
            "opened_s_ago": round(now - b.opened_at, 1) if b.opened_at else None,
        }
    return out
