"""AI response cache + token budget tracking.

Two independent concerns wrapped in one module because they share Redis:

1. **Response cache** — identical prompts return the same answer. We hash
   the (model, system, user, json_mode) tuple to a key and memoize the
   response for 30 days. Batching-style imports re-run the same prompts
   hundreds of times (e.g. "standardize these 50 ingredient names") —
   caching cuts the bill by 70-95% on reruns.

2. **Budget tracker** — count estimated tokens spent per day per provider.
   Exposed on /api/metrics and /api/admin/ai-budget. Optional hard cap:
   when today's spend exceeds ``AI_DAILY_BUDGET_USD`` the client raises
   ``BudgetExceededError`` instead of calling the API.

Graceful degradation: when Redis is unreachable the cache silently misses
and budget tracking no-ops. Never blocks the app on observability infra.
"""
from __future__ import annotations
import hashlib
import json
import logging
from datetime import datetime, timezone

import redis.asyncio as aioredis

from app.config import settings

logger = logging.getLogger(__name__)

CACHE_TTL = 30 * 86400   # 30 days
CACHE_NS = "batchchef:aicache:"
BUDGET_NS = "batchchef:aibudget:"

# Rough per-token cost (USD) — used only for the budget counter, not billing.
# Adjust if you switch models. These are approximate public list prices.
COST_PER_1K_TOKENS = {
    "gemini-3-flash-preview":        {"in": 0.000, "out": 0.000},  # free tier / experimental
    "gemini-3.1-flash-lite-preview": {"in": 0.000, "out": 0.000},
    "gemini-2.5-flash":              {"in": 0.000, "out": 0.000},
    "gemini-2.0-flash":              {"in": 0.000, "out": 0.000},
    # Claude Haiku 4.5 (Anthropic, April 2026)
    "claude-haiku-4-5-20251001":     {"in": 0.001, "out": 0.005},
}


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
            logger.warning("AI cache Redis init failed: %s", e)
            _redis = None
    return _redis


def _cache_key(model: str, system: str, user: str, json_mode: bool) -> str:
    """Stable hash of the semantic query. Model included so switching
    models doesn't serve stale answers from the previous model."""
    blob = json.dumps(
        {"m": model, "s": system, "u": user, "j": json_mode},
        sort_keys=True, ensure_ascii=False,
    )
    h = hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]
    return f"{CACHE_NS}{h}"


async def cache_get(model: str, system: str, user: str, json_mode: bool = False) -> str | None:
    r = _client()
    if r is None:
        return None
    try:
        return await r.get(_cache_key(model, system, user, json_mode))
    except Exception:
        return None


async def cache_put(model: str, system: str, user: str, response: str, json_mode: bool = False) -> None:
    r = _client()
    if r is None:
        return
    try:
        await r.setex(_cache_key(model, system, user, json_mode), CACHE_TTL, response)
    except Exception:
        pass


# ── Budget tracking ────────────────────────────────────────────────────────
def _est_tokens(text: str) -> int:
    """Rough estimate: ~4 chars per token for French/English mixed."""
    return max(1, len(text) // 4)


def _today_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def record_usage(
    provider: str,
    model: str,
    system: str,
    user: str,
    response: str,
) -> None:
    """Add to today's counter. Idempotent — exceptions are swallowed."""
    r = _client()
    if r is None:
        return
    in_tokens = _est_tokens(system) + _est_tokens(user)
    out_tokens = _est_tokens(response)
    rates = COST_PER_1K_TOKENS.get(model, {"in": 0.0, "out": 0.0})
    cost = (in_tokens / 1000.0) * rates["in"] + (out_tokens / 1000.0) * rates["out"]

    key = f"{BUDGET_NS}{_today_key()}"
    try:
        # HINCRBYFLOAT is atomic per field
        pipe = r.pipeline()
        pipe.hincrbyfloat(key, f"{provider}:in_tokens", in_tokens)
        pipe.hincrbyfloat(key, f"{provider}:out_tokens", out_tokens)
        pipe.hincrbyfloat(key, f"{provider}:cost_usd", cost)
        pipe.hincrbyfloat(key, "total_cost_usd", cost)
        pipe.expire(key, 40 * 86400)  # keep a month of history
        await pipe.execute()
    except Exception as e:
        logger.debug("budget record_usage failed: %s", e)


class BudgetExceededError(Exception):
    """Raised when today's estimated spend is >= the configured cap."""


async def assert_under_budget() -> None:
    """Raises if today's total_cost_usd is already at/past the cap.

    Cap is read from ``settings.AI_DAILY_BUDGET_USD``. Zero/unset = disabled.
    """
    cap = getattr(settings, "AI_DAILY_BUDGET_USD", 0.0) or 0.0
    if cap <= 0:
        return
    r = _client()
    if r is None:
        return
    try:
        spent_str = await r.hget(f"{BUDGET_NS}{_today_key()}", "total_cost_usd")
        spent = float(spent_str) if spent_str else 0.0
    except Exception:
        return
    if spent >= cap:
        raise BudgetExceededError(
            f"Daily AI budget reached: ${spent:.2f} ≥ ${cap:.2f} cap. "
            "Bump AI_DAILY_BUDGET_USD in .env or wait for tomorrow."
        )


async def today_usage() -> dict:
    """Return { provider: {in_tokens, out_tokens, cost_usd}, total_cost_usd }."""
    r = _client()
    if r is None:
        return {"redis_unavailable": True}
    try:
        raw = await r.hgetall(f"{BUDGET_NS}{_today_key()}")
    except Exception as e:
        return {"error": str(e)}
    out: dict = {"total_cost_usd": float(raw.get("total_cost_usd", "0") or 0)}
    providers: dict[str, dict[str, float]] = {}
    for k, v in raw.items():
        if ":" not in k:
            continue
        provider, metric = k.split(":", 1)
        providers.setdefault(provider, {})[metric] = float(v)
    out["providers"] = providers
    out["date"] = _today_key()
    out["cap_usd"] = getattr(settings, "AI_DAILY_BUDGET_USD", 0.0) or 0.0
    return out
