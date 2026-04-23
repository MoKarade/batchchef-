"""AI client — Gemini primary with automatic fallback to a lighter model.

Kept the legacy `call_claude` / `call_claude_vision` names so all existing
callers (classifier, standardizer, receipt_ocr, display_name_cleaner,
price_estimator, ingredient_dedup) keep working unchanged.
"""
import asyncio
import logging
import time
from google import genai
from google.genai import types as genai_types
from app.config import settings

logger = logging.getLogger(__name__)

_client: genai.Client | None = None

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


def _models_for_fallback(override: str | None) -> list[str]:
    if override:
        return [override]
    primary = settings.GEMINI_MODEL or "gemini-3-flash-preview"
    fallback = getattr(settings, "GEMINI_MODEL_FALLBACK", "") or "gemini-3.1-flash-lite-preview"
    return [primary, fallback] if fallback and fallback != primary else [primary]


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
            logger.warning(f"Gemini model '{m}' failed: {e}; trying next")
    raise last_err or RuntimeError("All Gemini models failed")


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
