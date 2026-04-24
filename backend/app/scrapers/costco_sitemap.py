"""Offline product catalogue from Costco's public sitemaps.

Costco exposes every product URL under:
    https://www.costco.ca/sitemap_lw_index.xml
        → sitemap_lw_p_001.xml   (products)
        → sitemap_lw_i_001.xml   (items?)
        → ...

URLs look like:
    https://www.costco.ca/bosch-dishwasher-junction-box.product.100526427.html
                         └──────── slug ────────────┘         └── itemId ──┘

We download them once (few MB total), parse in memory, build a token index,
then answer `search("eggs") → [itemId*]` in microseconds with zero network.

Pair this with `costco_api.search_costco()` which does the GraphQL lookup.
"""
from __future__ import annotations

import asyncio
import logging
import re
import threading
import time
from typing import Iterable

import httpx

logger = logging.getLogger(__name__)

INDEX_URL = "https://www.costco.ca/sitemap_lw_index.xml"
PRODUCT_URL_RE = re.compile(r"https://www\.costco\.ca/([^<>\s]+)\.product\.(\d+)\.html", re.I)

# Tokens shorter than this are too noisy to index on
_MIN_TOKEN_LEN = 3

# How long a loaded catalogue stays hot before we re-download
_CACHE_TTL_S = 24 * 3600

# Module-level cache
_catalogue: dict[str, str] = {}       # itemId → slug (raw, dash-separated, lowercased)
_token_index: dict[str, set[str]] = {}  # token → {itemId*}
_last_load_ts: float = 0.0
_load_lock = threading.Lock()


def _tokenize(s: str) -> list[str]:
    """Lowercase, split on non-alnum, filter short tokens."""
    return [t for t in re.split(r"[^a-z0-9]+", s.lower()) if len(t) >= _MIN_TOKEN_LEN]


_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
)


async def _fetch_sitemap(url: str, client: httpx.AsyncClient) -> str:
    r = await client.get(url, headers={"User-Agent": _BROWSER_UA}, timeout=30)
    r.raise_for_status()
    return r.text


async def _load_async() -> None:
    """Download + parse all Costco product sitemaps into the module cache."""
    global _last_load_ts
    # Explicit timeout — the sitemap is ~2 MB but sometimes Costco CDN
    # stalls. 60 s total, 10 s connect. Without this the import task can
    # hang indefinitely on a slow sitemap response.
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=httpx.Timeout(60.0, connect=10.0),
    ) as client:
        try:
            index_xml = await _fetch_sitemap(INDEX_URL, client)
        except Exception as e:
            logger.warning(f"Costco sitemap index fetch failed: {e}")
            return

        # Each <loc> points to a sub-sitemap
        sub_urls = re.findall(r"<loc>([^<]+)</loc>", index_xml)
        # Keep only ones that likely contain products ("_p_", "_i_", "_l_", "_r_")
        product_ish = [u for u in sub_urls if re.search(r"_([pilr])_\d", u)]
        logger.info(f"Costco sitemap: {len(product_ish)} product-ish sub-sitemaps")

        new_catalogue: dict[str, str] = {}
        for sub_url in product_ish:
            try:
                xml = await _fetch_sitemap(sub_url, client)
            except Exception as e:
                logger.warning(f"  skip {sub_url}: {e}")
                continue
            for slug, item_id in PRODUCT_URL_RE.findall(xml):
                new_catalogue[item_id] = slug.lower()

        logger.info(f"Costco sitemap: {len(new_catalogue)} products indexed")
        _catalogue.clear()
        _catalogue.update(new_catalogue)

        # Rebuild token index
        _token_index.clear()
        for item_id, slug in _catalogue.items():
            for tok in _tokenize(slug):
                _token_index.setdefault(tok, set()).add(item_id)

        _last_load_ts = time.time()


async def ensure_loaded() -> None:
    """Idempotent: download sitemap if we don't have it or it's stale."""
    if _catalogue and (time.time() - _last_load_ts) < _CACHE_TTL_S:
        return
    with _load_lock:
        if _catalogue and (time.time() - _last_load_ts) < _CACHE_TTL_S:
            return
        await _load_async()


# Noise tokens we don't count against a slug even if they're unmatched
_NOISE_TOKENS = {
    "ct", "pack", "each", "bag", "box", "count", "value", "family", "pk",
    "the", "and", "with", "for", "new", "super",
    "kg", "lb", "oz", "ml", "each", "ea",
    "organic", "natural", "fresh", "premium", "choice", "select", "classic",
}


def search(query: str, max_results: int = 20) -> list[tuple[str, str, float]]:
    """Fuzzy search the catalogue with position-weighted scoring.

    Returns [(itemId, slug, score)*] — higher score = better match.

    Scoring (designed to avoid "peanut butter" matching "butter"):
      + All query tokens must appear in the slug, else the candidate is dropped
        (except very short slugs with < 3 non-noise tokens, where we're lenient)
      + Position bonus: query's first token matching slug's first token = +2.0
        (the "primary ingredient" is almost always the first word of a
        Costco slug, e.g. "beurre-.." vs "beurre-darachide-..")
      + Penalty for slug "bloat": slug has many non-noise tokens that don't
        appear in the query (makes "peanut butter" worse than "butter")
      + Coverage: matched_tokens / total_query_tokens
    """
    q_tokens = _tokenize(query)
    if not q_tokens:
        return []
    q_set = set(q_tokens)
    first_q = q_tokens[0]

    # Candidates = any item that contains at least one query token
    candidate_ids: set[str] = set()
    for tok in q_tokens:
        candidate_ids.update(_token_index.get(tok, ()))
    # Short-token prefix expansion (oeuf → oeufs)
    for tok in q_tokens:
        if len(tok) < 6:
            for indexed_tok, ids in _token_index.items():
                if indexed_tok != tok and indexed_tok.startswith(tok):
                    candidate_ids.update(ids)

    scored: list[tuple[str, float]] = []
    for item_id in candidate_ids:
        slug = _catalogue.get(item_id, "")
        slug_tokens = _tokenize(slug)
        if not slug_tokens:
            continue

        # 1) All query tokens must match (literal or prefix)
        matched = 0
        for qt in q_tokens:
            if qt in slug_tokens:
                matched += 1
            elif len(qt) < 6 and any(st.startswith(qt) for st in slug_tokens):
                matched += 0.7
        if matched < 0.5 * len(q_tokens):
            continue  # too many query tokens missing

        # 2) Position bonus: first-token match is huge
        pos_bonus = 0.0
        if slug_tokens[0] == first_q:
            pos_bonus = 2.0
        elif len(first_q) >= 4 and slug_tokens[0].startswith(first_q):
            pos_bonus = 1.2
        elif first_q in slug_tokens[:2]:
            pos_bonus = 0.8  # 2nd-slot match (e.g. "nature-beurre")

        # 3) Bloat penalty: count signal slug tokens not in the query
        unmatched_slug_tokens = [
            t for t in slug_tokens
            if t not in q_set
            and t not in _NOISE_TOKENS
            and not t.isdigit()
        ]
        bloat_penalty = 0.15 * len(unmatched_slug_tokens)

        # 4) Coverage score
        coverage = matched / len(q_tokens)

        score = coverage * 2.0 + pos_bonus - bloat_penalty
        if score > 0:
            scored.append((item_id, score))

    scored.sort(key=lambda kv: -kv[1])
    return [(iid, _catalogue.get(iid, ""), score) for iid, score in scored[:max_results]]


def size() -> int:
    return len(_catalogue)
