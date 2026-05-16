"""Last-resort image finder — Bing Images first, DuckDuckGo fallback.

Used when every store-specific image path + OpenFoodFacts fail. No API
key required. Bing is tolerant of a few hundred queries per hour; DDG
rate-limits aggressively after ~10 back-to-back calls.

Public entrypoint: `find_product_image(query: str) → str | None`.
"""
from __future__ import annotations

import asyncio
import logging
import random
import re
import urllib.parse

import httpx

logger = logging.getLogger(__name__)

_UA_POOL = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
]

_BING_MURL_RE = re.compile(r'murl\\?&quot;:\\?&quot;([^&\\]+)&', re.I)
_DDG_VQD_RE = re.compile(r'vqd=["\']?([\d-]+)')

_CACHE: dict[str, str | None] = {}
_SEM = asyncio.Semaphore(3)


def _clean_query(q: str) -> str:
    """Strip non-alphanumeric edges, keep accents."""
    return re.sub(r"[^\w\s\u00C0-\u024F]+", " ", q or "").strip()


async def _verify(url: str, client: httpx.AsyncClient) -> bool:
    try:
        r = await client.head(url, timeout=5.0, follow_redirects=True)
        if r.status_code != 200:
            return False
        ctype = r.headers.get("content-type", "").lower()
        if not ctype.startswith("image/"):
            return False
        length = int(r.headers.get("content-length", "0") or "0")
        if 0 < length < 1500:  # reject tracking pixels
            return False
        return True
    except Exception:
        return False


async def _bing_search(query: str, client: httpx.AsyncClient, limit: int = 8) -> list[str]:
    try:
        r = await client.get(
            f"https://www.bing.com/images/search?q={urllib.parse.quote(query)}&form=HDRSC2&first=1",
        )
        if r.status_code != 200:
            return []
        # Bing embeds URLs in escaped JSON inside data attributes
        return _BING_MURL_RE.findall(r.text)[:limit]
    except Exception as e:
        logger.debug(f"bing search '{query}': {e}")
        return []


async def _ddg_search(query: str, client: httpx.AsyncClient, limit: int = 5) -> list[str]:
    try:
        r1 = await client.get(f"https://duckduckgo.com/?q={urllib.parse.quote(query)}")
        m = _DDG_VQD_RE.search(r1.text)
        if not m:
            return []
        vqd = m.group(1)
        r2 = await client.get(
            "https://duckduckgo.com/i.js",
            params={"l": "us-en", "o": "json", "q": query, "vqd": vqd, "f": ",,,,,", "p": "1"},
            headers={"Referer": "https://duckduckgo.com/"},
        )
        if r2.status_code != 200:
            return []
        try:
            data = r2.json()
        except Exception:
            return []
        return [r.get("image") for r in (data.get("results") or [])[:limit] if r.get("image")]
    except Exception as e:
        logger.debug(f"ddg search '{query}': {e}")
        return []


async def find_product_image(query: str, max_try: int = 5) -> str | None:
    """Find a verified product image URL. Hits Bing then DDG, returns first
    URL that HEAD-resolves to a real image."""
    q = _clean_query(query)
    if not q:
        return None
    if q in _CACHE:
        return _CACHE[q]

    async with _SEM:
        async with httpx.AsyncClient(
            timeout=10.0,
            headers={"User-Agent": random.choice(_UA_POOL)},
            follow_redirects=True,
        ) as client:
            # Primary: Bing (much more tolerant than DDG)
            candidates = await _bing_search(q, client, limit=max_try * 2)
            # Secondary: DDG
            if not candidates:
                candidates = await _ddg_search(q, client, limit=max_try)

            for url in candidates[:max_try]:
                if not url or not url.startswith("http"):
                    continue
                # Some Bing URLs are HTML-entity encoded — unescape them
                url = url.replace("&amp;", "&")
                if await _verify(url, client):
                    _CACHE[q] = url
                    return url

    _CACHE[q] = None
    return None
