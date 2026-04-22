"""Anthropic Claude client + shared async helpers for JSON-returning calls."""
import asyncio
import base64
import logging
import time
from anthropic import AsyncAnthropic
from app.config import settings

logger = logging.getLogger(__name__)

_client: AsyncAnthropic | None = None

# Free-tier safety: 5 RPM = 12s between calls. Set MIN_CLAUDE_INTERVAL=0 to disable.
_MIN_INTERVAL = float(getattr(settings, "CLAUDE_MIN_INTERVAL_S", 12.5))
_rate_lock = asyncio.Lock()
_last_call_ts = 0.0


async def _throttle() -> None:
    """Serialize Claude calls with a min interval to stay under Free-tier 5 RPM."""
    global _last_call_ts
    if _MIN_INTERVAL <= 0:
        return
    async with _rate_lock:
        now = time.monotonic()
        wait = _MIN_INTERVAL - (now - _last_call_ts)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_call_ts = time.monotonic()


def get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


async def call_claude(
    system: str,
    user: str,
    model: str | None = None,
    max_tokens: int = 8192,
    temperature: float = 0.0,
) -> str:
    """Plain text-in, text-out Claude call. Returns the raw response text."""
    await _throttle()
    client = get_client()
    resp = await client.messages.create(
        model=model or settings.CLAUDE_MODEL,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return resp.content[0].text


async def call_claude_vision(
    system: str,
    user_text: str,
    image_bytes: bytes,
    image_mime: str,
    model: str | None = None,
    max_tokens: int = 8192,
) -> str:
    """Vision input via Claude (expects raw image bytes + mime type)."""
    await _throttle()
    client = get_client()
    resp = await client.messages.create(
        model=model or settings.CLAUDE_MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": image_mime,
                        "data": base64.b64encode(image_bytes).decode(),
                    },
                },
                {"type": "text", "text": user_text},
            ],
        }],
    )
    return resp.content[0].text
