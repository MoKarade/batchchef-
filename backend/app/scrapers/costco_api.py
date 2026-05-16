"""Costco scraper — hybrid sitemap + GraphQL.

Flow:
  1. `ensure_ready(browser_page)` — one-time warm-up per context:
       - load costco.ca homepage (so Akamai issues _abck, bm_sz, etc.)
       - copy the resulting cookies into an httpx-friendly jar
       - load the sitemap catalogue (~8 000 product URLs, ~1 MB)
  2. `search_costco(query)`:
       - fuzzy-match the query against the sitemap → candidate itemIds
       - POST the GraphQL endpoint with those itemIds + warmed-up cookies
       - rank the returned products by relevance × cheapest
       - HEAD-verify the image URL, fall back to OpenFoodFacts

The old `scrapers/costco.py` (DOM scraping) is kept as a fallback if the
sitemap/GraphQL path returns nothing for a given ingredient.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any

import httpx

from app.config import settings
from app.scrapers import costco_sitemap
from app.scrapers._utils import (
    is_relevant,
    parse_format,
    fetch_nutrition_openfoodfacts,
    try_accept_cookies,
)

logger = logging.getLogger(__name__)

GRAPHQL_URL = "https://ecom-api.costco.com/ebusiness/product/v1/products/graphql"
CLIENT_ID = "e442e6e6-2602-4a39-937b-8b28b4457ed3"
WAREHOUSE_NUMBER = "894"  # default; can be overridden per request

# Map French → English ingredient tokens (Costco slugs are English only).
# Covers the most common Québec staples; unmatched queries fall through to
# the raw query (which may still match English words).
FR_EN = {
    "oeuf": "egg", "oeufs": "eggs",
    "beurre": "butter",
    "lait": "milk",
    "farine": "flour",
    "sel": "salt",
    "sucre": "sugar",
    "poivre": "pepper",
    "huile": "oil",
    "huile_olive": "olive oil",
    "poulet": "chicken",
    "boeuf": "beef",
    "porc": "pork",
    "jambon": "ham",
    "thon": "tuna",
    "saumon": "salmon",
    "riz": "rice",
    "pates": "pasta",
    "pain": "bread",
    "fromage": "cheese",
    "yogourt": "yogurt",
    "pomme": "apple",
    "banane": "banana",
    "orange": "orange",
    "citron": "lemon",
    "tomate": "tomato",
    "oignon": "onion",
    "ail": "garlic",
    "carotte": "carrot",
    "patate": "potato",
    "pomme_de_terre": "potato",
    "brocoli": "broccoli",
    "epinard": "spinach",
    "laitue": "lettuce",
    "cafe": "coffee",
    "the": "tea",
    "miel": "honey",
    "amande": "almond", "amandes": "almonds",
    "noix": "nuts",
    "chocolat": "chocolate",
    "vinaigre": "vinegar",
    "moutarde": "mustard",
    "ketchup": "ketchup",
    "mayo": "mayonnaise",
    "creme": "cream",
    "tofu": "tofu",
    "quinoa": "quinoa",
    "avocat": "avocado",
    "fraise": "strawberry", "fraises": "strawberries",
    "bleuet": "blueberry", "bleuets": "blueberries",
    "framboise": "raspberry", "framboises": "raspberries",
}


def _fr_to_en(query: str) -> str:
    """Translate a French ingredient name to English using the fixed table
    above. Falls back to the original query if no token matched."""
    tokens = re.split(r"[^a-z]+", query.lower())
    mapped = [FR_EN.get(t, t) for t in tokens if t]
    return " ".join(mapped)


# ──────────────────────────────────────────────────────────────────────────
# Session state: cookies from the browser warm-up, used by httpx on every
# GraphQL call. Refreshed hourly.
# ──────────────────────────────────────────────────────────────────────────
_cookie_jar: httpx.Cookies | None = None
_cookies_ts: float = 0.0
_COOKIES_TTL_S = 30 * 60  # 30 min is safe; longer flies through Akamai

_warmed_contexts: set[int] = set()


def _graphql_headers() -> dict[str, str]:
    return {
        "accept": "*/*",
        "accept-language": "en-CA,en;q=0.9,fr-CA;q=0.8",
        "content-type": "application/json",
        "origin": "https://www.costco.ca",
        "referer": "https://www.costco.ca/",
        "user-agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
        ),
        "client-identifier": CLIENT_ID,
        "costco.env": "ecom",
        "costco.service": "restProduct",
        "sec-ch-ua": '"Google Chrome";v="121", "Not.A/Brand";v="8", "Chromium";v="121"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
    }


def _graphql_body(item_numbers: list[str]) -> dict:
    numbers_arr = ",".join(f'"{n}"' for n in item_numbers)
    q = (
        "query { products("
        f"itemNumbers: [{numbers_arr}], "
        f'clientId: "{CLIENT_ID}", '
        'locale: "en-ca", '
        f'warehouseNumber: "{WAREHOUSE_NUMBER}"'
        ") { catalogData { "
        "itemNumber itemId published locale buyable programTypes "
        "priceData { price listPrice } "
        "attributes { key value } "
        "} } }"
    )
    return {"query": q}


async def _refresh_cookies(browser_page) -> None:
    """Visit Costco homepage in the browser to get Akamai cookies, then copy
    them into `_cookie_jar` for httpx. Idempotent per context for 30 min."""
    global _cookie_jar, _cookies_ts
    ctx_id = id(browser_page.context)
    fresh = ctx_id in _warmed_contexts and (time.time() - _cookies_ts) < _COOKIES_TTL_S
    if fresh:
        return
    try:
        await browser_page.goto("https://www.costco.ca/", wait_until="domcontentloaded", timeout=40000)
        await browser_page.wait_for_timeout(4000)
        await try_accept_cookies(browser_page)
        await browser_page.evaluate(
            "document.querySelector('#onetrust-consent-sdk')?.remove();"
        )
        await browser_page.wait_for_timeout(1500)

        raw = await browser_page.context.cookies()
        jar = httpx.Cookies()
        for c in raw:
            try:
                jar.set(c["name"], c["value"], domain=c.get("domain", ".costco.ca"))
            except Exception:
                continue
        _cookie_jar = jar
        _cookies_ts = time.time()
        _warmed_contexts.add(ctx_id)
        logger.info(f"Costco cookies refreshed ({len(raw)} cookies)")
    except Exception as e:
        logger.warning(f"Costco warm-up: {e}")


# ──────────────────────────────────────────────────────────────────────────
# Response parsing helpers
# ──────────────────────────────────────────────────────────────────────────

def _attr(item: dict, *keys: str) -> str | None:
    keys_lower = [k.lower() for k in keys]
    for a in item.get("attributes") or []:
        if (a.get("key") or "").lower() in keys_lower:
            v = a.get("value")
            if v:
                return str(v)
    return None


def _price(item: dict) -> float | None:
    pd = item.get("priceData") or {}
    for k in ("price", "memberPrice", "listPrice"):
        raw = pd.get(k)
        if raw is None:
            continue
        try:
            p = float(str(raw).replace(",", "."))
        except (TypeError, ValueError):
            continue
        if 0 < p < 5000:
            return round(p, 2)
    return None


def _format(item: dict, fallback_name: str = "") -> tuple[float, str]:
    # 1. Typed attributes first
    for key in ("Item Weight", "NetWeight", "ItemNetContent", "Size", "ItemSize", "Unit Size", "Quantity"):
        v = _attr(item, key)
        if v:
            fmt = parse_format(str(v))
            if fmt.get("qty") and fmt.get("unit") != "unite":
                return fmt["qty"], fmt["unit"]
    # 2. Explicit name attributes
    name = _attr(item, "ProductName", "Name", "Title") or ""
    if name:
        fmt = parse_format(name)
        if fmt.get("qty") and fmt.get("unit") != "unite":
            return fmt["qty"], fmt["unit"]
    # 3. Fallback: parse the sitemap-derived name (has the "2 kg" / "500 g" hints)
    if fallback_name:
        # Also handle multiplied formats: "24 × 33 g" → 24*33 = 792 g
        m = re.search(r"(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)\b", fallback_name.lower())
        if m:
            count = float(m.group(1).replace(",", "."))
            per = float(m.group(2).replace(",", "."))
            unit = m.group(3)
            return count * per, unit
        fmt = parse_format(fallback_name)
        if fmt.get("qty") and fmt.get("unit") != "unite":
            return fmt["qty"], fmt["unit"]
    return 1.0, "unite"


def _image(item: dict) -> str | None:
    """First-pass heuristic only. The real image comes from the product page
    via `_fetch_product_image()` (browser-authenticated) because the GraphQL
    schema doesn't expose an image field."""
    for k in ("imageUrl", "image", "primaryImageURL", "mainImage"):
        v = item.get(k)
        if isinstance(v, str) and v.startswith("http"):
            return v
    for a in item.get("attributes") or []:
        key = (a.get("key") or "").lower()
        if "image" in key and "url" in key:
            v = a.get("value")
            if isinstance(v, str) and v.startswith("http"):
                return v
    return None


# Cache image URLs per-itemNumber for the process lifetime
_IMAGE_CACHE: dict[str, str | None] = {}


async def _fetch_product_image(page, product_url: str, item_number: str | None) -> str | None:
    """Hit the Costco product page through the warmed-up browser, extract
    og:image meta tag. Single-page fetch, ~2-5 s. Cached per-itemNumber."""
    if item_number and item_number in _IMAGE_CACHE:
        return _IMAGE_CACHE[item_number]
    if not product_url:
        return None
    try:
        # Use browser's fetch() so Akamai cookies are attached automatically.
        html = await page.evaluate(
            """async (url) => {
                try {
                    const r = await fetch(url, {credentials: 'include'});
                    if (!r.ok) return null;
                    return await r.text();
                } catch { return null; }
            }""",
            product_url,
        )
        if not html:
            return None
        # og:image is the canonical product thumbnail
        m = re.search(r'<meta\s+property="og:image"\s+content="([^"]+)"', html, re.I)
        if not m:
            m = re.search(r'<meta\s+name="og:image"\s+content="([^"]+)"', html, re.I)
        img_url = m.group(1) if m else None
        if img_url and not img_url.startswith("http"):
            img_url = f"https://www.costco.ca{img_url}" if img_url.startswith("/") else None
        if item_number:
            _IMAGE_CACHE[item_number] = img_url
        return img_url
    except Exception as e:
        logger.debug(f"costco image fetch: {e}")
        return None


def _url(item: dict) -> str | None:
    item_id = item.get("itemId") or item.get("itemNumber")
    if not item_id:
        return None
    # Prefer the exact slug from the sitemap if the caller attached it
    pre_slug = item.get("_slug")
    if pre_slug:
        return f"https://www.costco.ca/{pre_slug}.product.{item_id}.html"
    name = _attr(item, "ProductName", "Name", "Title") or "product"
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60] or "product"
    return f"https://www.costco.ca/{slug}.product.{item_id}.html"


# ──────────────────────────────────────────────────────────────────────────
# Public API — compatible signature with scrapers/maxi.py::search_maxi
# ──────────────────────────────────────────────────────────────────────────

async def search_costco(page, query: str, store_id: str | None = None) -> dict | None:
    """Returns {store, product_name, price, image_url, format_qty, ...} or None.

    `page` is a patchright Page (needed to refresh Akamai cookies). For
    testing without a browser, pass a page object that has already been
    warmed up.
    """
    # 1) make sure sitemap is loaded + cookies fresh
    await costco_sitemap.ensure_loaded()
    await _refresh_cookies(page)

    if _cookie_jar is None:
        logger.warning("Costco API: no cookies available, aborting")
        return None

    # 2) fuzzy search sitemap → itemIds + slugs
    en_query = _fr_to_en(query)
    hits = costco_sitemap.search(en_query, max_results=15)
    if not hits:
        logger.info(f"Costco sitemap: no match for '{query}' (translated '{en_query}')")
        return None

    item_ids = [iid for iid, _, _ in hits]
    slug_by_id = {iid: slug for iid, slug, _ in hits}

    # 3) call GraphQL for details
    try:
        async with httpx.AsyncClient(cookies=_cookie_jar, timeout=15.0) as c:
            r = await c.post(GRAPHQL_URL, headers=_graphql_headers(), json=_graphql_body(item_ids))
            if r.status_code != 200:
                logger.warning(f"Costco GraphQL {r.status_code}: {r.text[:200]}")
                return None
            data = r.json()
    except Exception as e:
        logger.warning(f"Costco GraphQL call failed: {e}")
        return None

    items = (data.get("data", {}).get("products", {}) or {}).get("catalogData") or []
    if not items:
        return None

    # 4) rank buyable + price + name relevance
    import urllib.parse as _up
    candidates: list[dict] = []
    for it in items:
        if not it.get("buyable"):
            continue
        # Name sources (first win): ProductName attr → explicit names → sitemap slug (decoded)
        name = _attr(it, "ProductName", "Name", "Title", "DisplayName") or ""
        if not name:
            iid = it.get("itemNumber") or it.get("itemId")
            slug = slug_by_id.get(str(iid), "")
            if slug:
                # "cadbury-mini-eggs-candies%2c-24-%c3%97-38-g" → "cadbury mini eggs candies, 24 × 38 g"
                name = _up.unquote(slug).replace("-", " ").strip()
        if not name or len(name) < 3:
            continue
        price = _price(it)
        if price is None:
            continue
        fq, fu = _format(it, fallback_name=name)
        candidates.append({
            "name": name,
            "brand": _attr(it, "Brand"),
            "price": price,
            "format_qty": fq,
            "format_unit": fu,
            "product_url": _url({**it, "_slug": slug_by_id.get(str(it.get("itemNumber") or it.get("itemId")))}),
            "image_url": _image(it),
        })

    relevant = [c for c in candidates if is_relevant(en_query, c["name"])]
    if not relevant:
        # fall back to cheapest candidate with at least one shared token
        tokens = set(re.split(r"[^a-z]+", en_query.lower()))
        relevant = [c for c in candidates if any(t in c["name"].lower() for t in tokens if len(t) > 2)]
    if not relevant:
        return None

    best = min(relevant, key=lambda c: c["price"])

    # 5) Image resolution cascade:
    #    a. image from GraphQL (rarely present)
    #    b. OpenFoodFacts with the Costco product name (more specific match)
    #    c. OpenFoodFacts with the original query (broader fallback)
    # Note: Costco product pages are Akamai-gated + SPA-rendered; scraping
    #       og:image from them is unreliable. OFF covers ~70% of packaged
    #       goods in Costco's catalogue (Kirkland Signature etc.).
    async def _verify(u: str) -> bool:
        try:
            async with httpx.AsyncClient(timeout=4.0) as c:
                r = await c.head(u, follow_redirects=True)
                return r.status_code == 200 and r.headers.get("content-type", "").startswith("image/")
        except Exception:
            return False

    final_image = best.get("image_url")
    if final_image and not await _verify(final_image):
        final_image = None

    # Try OFF with the product name first (most specific)
    if not final_image:
        # Strip format suffix for a cleaner OFF query: "Kraft Smooth Peanut Butter, 2 kg" → "Kraft Smooth Peanut Butter"
        clean_name = re.sub(r",\s*\d+[.,]?\d*\s*(kg|g|ml|l|oz|lb)\b.*$", "", best["name"], flags=re.I).strip()
        off_name = await fetch_nutrition_openfoodfacts(clean_name[:60])
        cand = off_name.get("off_image_url")
        if cand and await _verify(cand):
            final_image = cand

    # Final fallback: OFF with canonical ingredient query
    nutrition = await fetch_nutrition_openfoodfacts(en_query)
    if not final_image:
        cand2 = nutrition.pop("off_image_url", None)
        if cand2 and await _verify(cand2):
            final_image = cand2
    else:
        nutrition.pop("off_image_url", None)

    # Last resort: DuckDuckGo image search with the product name. Gets us
    # ~95-100 % coverage since DDG scrapes Amazon / Walmart / retailer
    # catalogues that have the same packaging.
    if not final_image:
        from app.scrapers._image_search import find_product_image
        ddg_query = f"{best['name']} costco" if "costco" not in best["name"].lower() else best["name"]
        ddg_img = await find_product_image(ddg_query[:80])
        if ddg_img:
            final_image = ddg_img

    logger.info(
        f"Costco-API OK '{query}' → {best['name'][:60]} | ${best['price']} "
        f"({best['format_qty']} {best['format_unit']})"
    )
    return {
        "store": "costco",
        "product_name": best["name"],
        "brand": best.get("brand"),
        "price": best["price"],
        "product_url": best.get("product_url"),
        "image_url": final_image,
        "format_qty": best["format_qty"],
        "format_unit": best["format_unit"],
        **nutrition,
    }
