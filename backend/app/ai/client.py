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

import anthropic
from google import genai
from google.genai import types as genai_types

from app.config import settings

logger = logging.getLogger(__name__)

_client: genai.Client | None = None
_anthropic_client: anthropic.AsyncAnthropic | None = None

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


def get_anthropic_client() -> anthropic.AsyncAnthropic | None:
    """Lazy init, returns None if no API key is set."""
    global _anthropic_client
    if _anthropic_client is not None:
        return _anthropic_client
    if not settings.ANTHROPIC_API_KEY:
        return None
    _anthropic_client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _anthropic_client


async def _call_claude_fallback(
    system: str,
    user_prompt: str,
    max_tokens: int,
    temperature: float,
) -> str | None:
    """Final fallback when all Gemini tiers fail (billing cap, quota, etc).
    Uses Haiku — cheapest Claude model — to stay economical.
    Returns the response text, or None if no API key / call fails.
    """
    ac = get_anthropic_client()
    if ac is None:
        return None
    try:
        resp = await ac.messages.create(
            model=settings.CLAUDE_MODEL or "claude-haiku-4-5-20251001",
            max_tokens=max_tokens,
            temperature=temperature,
            system=system or "",
            messages=[{"role": "user", "content": user_prompt}],
        )
        # Stitch all text blocks into one string
        parts: list[str] = []
        for block in resp.content:
            if hasattr(block, "text"):
                parts.append(block.text)
        return "".join(parts) or None
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

    Tries primary model first; on any error falls back to lighter model.
    Concatenates `system` + `user` as a single prompt (Gemini's system
    instruction arg is model-dependent and noisier).
    """
    await _throttle()
    client = get_client()
    prompt = f"{system}\n\n{user}" if system else user
    # Heuristic: if the prompt asks for JSON, switch Gemini into strict JSON mode.
    want_json = "JSON" in (system or "") or "json" in (system or "")
    models = _models_for_fallback(model)
    last_err: Exception | None = None
    # Gemini 3 Flash Preview uses an internal "thinking budget" that eats
    # into max_output_tokens before the final response is generated. With
    # the old 8192 default, ~7 KB goes to thinking and the visible response
    # truncates around char 800. Bumping to 32768 leaves plenty for both.
    effective_max = max(max_tokens, 32768)
    global _gemini_hard_fail
    if not _gemini_hard_fail:
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
                    return text
                last_err = RuntimeError(f"{m}: empty response")
            except Exception as e:
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
