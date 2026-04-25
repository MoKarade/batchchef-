"""AI client — Gemini primary with automatic fallback to a lighter model,
and a final Claude Haiku fallback when all Gemini tiers fail (e.g. when
the Gemini billing cap is hit).

Kept the legacy `call_claude` / `call_claude_vision` names so all existing
callers (classifier, standardizer, receipt_ocr, display_name_cleaner,
ingredient_dedup, name_cleaner) keep working unchanged.
"""
import asyncio
import logging
import time

import httpx
from google import genai
from google.genai import types as genai_types

from app.config import settings

logger = logging.getLogger(__name__)

_client: genai.Client | None = None
_anthropic_http: httpx.AsyncClient | None = None
_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"

# Once we see a hard Gemini quota/billing error, skip Gemini for the rest
# of the process — every subsequent call would just eat 4s waiting for
# four 429s before hitting the Claude fallback.
_gemini_hard_fail = False

# Gemini free tier ~10 RPM. Set GEMINI_MIN_INTERVAL_S=0 on paid tier.
_MIN_INTERVAL = float(getattr(settings, "GEMINI_MIN_INTERVAL_S", 6.0))
_rate_lock = asyncio.Lock()
_last_call_ts = 0.0


async def _throttle() -> None:
    global _last_call_ts
    if _MIN_INTERVAL <= 0:
        return
    async with _rate_lock:
        now = time.monotonic()
        wait = _MIN_INTERVAL - (now - _last_call_ts)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_call_ts = time.monotonic()


def get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.GEMINI_API_KEY)
    return _client


def _get_anthropic_http() -> httpx.AsyncClient | None:
    """Lazy init of an httpx AsyncClient for Claude.

    Intentionally bypasses the `anthropic` SDK: on Windows with Python 3.14
    the SDK's messages.create() hangs forever on certain response chunks.
    Direct httpx is snappy (~0.5s per call) and the Messages API is a
    straightforward JSON endpoint.
    """
    global _anthropic_http
    if _anthropic_http is not None:
        return _anthropic_http
    if not settings.ANTHROPIC_API_KEY:
        return None
    _anthropic_http = httpx.AsyncClient(timeout=30.0)
    return _anthropic_http


async def _call_claude_fallback(
    system: str,
    user_prompt: str,
    max_tokens: int,
    temperature: float,
) -> str | None:
    """Final fallback when all Gemini tiers fail (billing cap, quota, etc).
    Uses Haiku via direct httpx call to stay economical.
    Returns the response text, or None if no API key / call fails.

    Wrapped in a circuit breaker — if Anthropic is rate-limiting us we
    stop calling for ``cooldown_s`` rather than piling on 429s during a
    long import.
    """
    from app.utils.circuit_breaker import call_with_breaker, CircuitOpenError

    http = _get_anthropic_http()
    if http is None:
        return None

    async def _do() -> str | None:
        r = await http.post(
            _ANTHROPIC_URL,
            headers={
                "content-type": "application/json",
                "x-api-key": settings.ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": settings.CLAUDE_MODEL or "claude-haiku-4-5-20251001",
                "max_tokens": max_tokens,
                "temperature": temperature,
                "system": system or "",
                "messages": [{"role": "user", "content": user_prompt}],
            },
        )
        # 429 and 5xx are "try again later" — let the circuit breaker count
        # them as failures. 4xx other than 429 is "our mistake" — don't
        # trip the breaker, just return None.
        if r.status_code == 429 or r.status_code >= 500:
            raise RuntimeError(f"Claude HTTP {r.status_code}: {r.text[:200]}")
        if r.status_code != 200:
            logger.warning(f"Claude fallback HTTP {r.status_code}: {r.text[:200]}")
            return None
        data = r.json()
        parts: list[str] = []
        for block in data.get("content") or []:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text") or "")
        return "".join(parts) or None

    try:
        return await call_with_breaker(
            "anthropic", _do,
            failure_threshold=8,   # 8 errors in 60s → open
            window_s=60.0,
            cooldown_s=120.0,      # 2 min cool-off
        )
    except CircuitOpenError as e:
        logger.warning("Claude breaker open: %s", e)
        return None
    except Exception as e:
        logger.warning(f"Claude fallback failed: {e}")
        return None


# Fallback chain: when the primary model fails (quota, billing cap, 5xx,
# empty response), we try each of these in order. Configured via env:
#   GEMINI_MODEL=<primary>  (default: gemini-3-flash-preview)
#   GEMINI_MODEL_FALLBACK=<m1,m2,m3,...>  (comma-separated, any length)
# Default chain covers the 4-tier progression the user asked for:
#   3-flash-preview  →  3.1-flash-lite-preview  →  2.5-flash  →  2.0-flash
_DEFAULT_FALLBACK_CHAIN = (
    "gemini-3.1-flash-lite-preview",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
)


def _models_for_fallback(override: str | None) -> list[str]:
    if override:
        return [override]
    primary = settings.GEMINI_MODEL or "gemini-3-flash-preview"
    fallback_str = getattr(settings, "GEMINI_MODEL_FALLBACK", "") or ",".join(_DEFAULT_FALLBACK_CHAIN)
    fallbacks = [m.strip() for m in fallback_str.split(",") if m.strip()]
    chain: list[str] = [primary]
    for m in fallbacks:
        if m and m not in chain:
            chain.append(m)
    return chain


async def call_claude(
    system: str,
    user: str,
    model: str | None = None,
    max_tokens: int = 8192,
    temperature: float = 0.0,
) -> str:
    """Text-in, text-out Gemini call. Name kept for back-compat.

    Tries primary model first; on any error falls back through the model
    chain (see ``_models_for_fallback``), and finally to Claude Haiku
    when Gemini hard-fails (billing cap / quota exhausted).
    Concatenates `system` + `user` as a single prompt (Gemini's system
    instruction arg is model-dependent and noisier).
    """
    # ── Cheap-win: cache lookup before paying for a call ─────────────────
    # Same (model+system+user+json_mode) → same answer, good for 30 days.
    # Importers re-run identical prompts thousands of times (e.g. "standardize
    # these 50 ingredient names") — cache hit rate typically 70-95% on reruns.
    from app.utils.ai_budget import (
        cache_get, cache_put, record_usage, assert_under_budget, BudgetExceededError,
    )

    want_json = "JSON" in (system or "") or "json" in (system or "")
    # Use the primary model name for the cache key so model switches invalidate
    cache_model_key = model or (settings.GEMINI_MODEL or "gemini-3-flash-preview")
    try:
        cached = await cache_get(cache_model_key, system or "", user or "", want_json)
        if cached is not None:
            return cached
    except Exception:
        pass

    # Budget gate — if the user configured a daily cap and we're past it,
    # refuse the call BEFORE paying for tokens.
    try:
        await assert_under_budget()
    except BudgetExceededError as e:
        logger.warning("AI budget cap hit: %s", e)
        raise

    await _throttle()
    client = get_client()
    prompt = f"{system}\n\n{user}" if system else user
    models = _models_for_fallback(model)
    last_err: Exception | None = None
    # Gemini 3 Flash Preview uses an internal "thinking budget" that eats
    # into max_output_tokens before the final response is generated. With
    # the old 8192 default, ~7 KB goes to thinking and the visible response
    # truncates around char 800. Bumping to 32768 leaves plenty for both.
    effective_max = max(max_tokens, 32768)
    global _gemini_hard_fail

    # Circuit breaker on Gemini as a whole — if we're accumulating failures
    # across models (e.g. all-region outage), stop for a cooldown before
    # burning through retries.
    from app.utils.circuit_breaker import get_breaker, CircuitOpenError
    gemini_breaker = get_breaker(
        "gemini", failure_threshold=10, window_s=60.0, cooldown_s=60.0,
    )

    if not _gemini_hard_fail and gemini_breaker.state() != "open":
        for m in models:
            try:
                cfg_kwargs = dict(
                    temperature=temperature,
                    max_output_tokens=effective_max,
                )
                if want_json:
                    cfg_kwargs["response_mime_type"] = "application/json"
                resp = await asyncio.to_thread(
                    client.models.generate_content,
                    model=m,
                    contents=prompt,
                    config=genai_types.GenerateContentConfig(**cfg_kwargs),
                )
                text = resp.text or ""
                if text:
                    gemini_breaker.record_success()
                    # Cache-through + usage recording. Failure here is
                    # non-fatal — the call succeeded, the user gets their
                    # answer, we just don't learn from it.
                    try:
                        await cache_put(cache_model_key, system or "", user or "", text, want_json)
                        await record_usage("gemini", m, system or "", user or "", text)
                    except Exception:
                        pass
                    return text
                last_err = RuntimeError(f"{m}: empty response")
                gemini_breaker.record_failure()
            except Exception as e:
                gemini_breaker.record_failure()
                last_err = e
                err_str = str(e).lower()
                logger.warning(f"Gemini model '{m}' failed: {e}; trying next")
                # Hard-fail markers: billing cap / project quota exhausted.
                # These are project-level — switching model inside Gemini
                # won't help, and the state won't change for the rest of
                # this process. Short-circuit to Claude immediately.
                if (
                    "resource_exhausted" in err_str
                    or "billing" in err_str
                    or "spending cap" in err_str
                    or "quota exceeded" in err_str
                ):
                    _gemini_hard_fail = True
                    logger.warning(
                        "Gemini hard-fail detected — skipping Gemini for the rest of this process"
                    )
                    break

    # All Gemini tiers failed (or skipped) — try Claude Haiku as fallback
    if _gemini_hard_fail:
        logger.debug("Using Claude (Gemini disabled for this session)")
    else:
        logger.info("All Gemini models exhausted — falling back to Claude Haiku")
    claude_text = await _call_claude_fallback(system, user, max_tokens, temperature)
    if claude_text:
        try:
            await cache_put(cache_model_key, system or "", user or "", claude_text, want_json)
            await record_usage("anthropic", settings.CLAUDE_MODEL, system or "", user or "", claude_text)
        except Exception:
            pass
        return claude_text
    raise last_err or RuntimeError("All Gemini + Claude fallbacks failed")


async def call_claude_vision(
    system: str,
    user_text: str,
    image_bytes: bytes,
    image_mime: str,
    model: str | None = None,
    max_tokens: int = 8192,
) -> str:
    """Vision input via Gemini. Kept name for back-compat."""
    await _throttle()
    client = get_client()
    prompt = f"{system}\n\n{user_text}" if system else user_text
    models = _models_for_fallback(model)
    last_err: Exception | None = None
    for m in models:
        try:
            resp = await asyncio.to_thread(
                client.models.generate_content,
                model=m,
                contents=[
                    genai_types.Part.from_bytes(data=image_bytes, mime_type=image_mime),
                    prompt,
                ],
                config=genai_types.GenerateContentConfig(
                    max_output_tokens=max_tokens,
                ),
            )
            text = resp.text or ""
            if text:
                return text
            last_err = RuntimeError(f"{m}: empty response")
        except Exception as e:
            last_err = e
            logger.warning(f"Gemini vision '{m}' failed: {e}; trying next")
    raise last_err or RuntimeError("All Gemini vision models failed")
