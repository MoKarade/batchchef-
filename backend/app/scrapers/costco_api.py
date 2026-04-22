"""Costco scraper v3 — intercept the GraphQL JSON response instead of
scraping the DOM.

How the Costco SPA works (reverse-engineered 2026-04):
  1. Browser GETs /s?keyword=eggs   (server-side: Akamai-gated HTML shell)
  2. JS bundle loads, reads the keyword, POSTs to a search endpoint that
     returns an ordered list of `itemNumber`s
  3. JS batches those itemNumbers and calls
     POST https://ecom-api.costco.com/ebusiness/product/v1/products/graphql
     with { query: "{ products(itemNumbers:[…], clientId:…, locale:"en-ca",
     warehouseNumber:"894"){ catalogData{...}}" }}
  4. That response is what the UI renders.

We let patchright drive steps 1-3 (so Akamai cookies + warehouse selection
work), then intercept step 4's JSON directly. Much faster than scraping
the rendered DOM and more resilient to DOM refactors.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import urllib.parse
from typing import Any

import httpx

from app.config import settings
from app.scrapers._utils import (
    is_relevant,
    parse_format,
    fetch_nutrition_openfoodfacts,
    try_accept_cookies,
)

logger = logging.getLogger(__name__)

GRAPHQL_URL = "https://ecom-api.costco.com/ebusiness/product/v1/products/graphql"

# Process-lifetime cache of the GraphQL response for each keyword — Costco
# takes ~3-5 s to return one search, so we don't want to redo it on retries.
_SEARCH_CACHE: dict[str, list[dict]] = {}
_WARMED: set[int] = set()


def _extract_price(catalog_item: dict) -> float | None:
    """From GraphQL catalogData row → raw decimal price, or None."""
    pd = catalog_item.get("priceData") or {}
    raw = pd.get("price") or pd.get("memberPrice") or pd.get("regularPrice")
    if raw is None:
        return None
    try:
        p = float(str(raw).replace(",", "."))
        if p <= 0 or p > 5000:
            return None
        return round(p, 2)
    except (TypeError, ValueError):
        return None


def _extract_attr(catalog_item: dict, key: str) -> str | None:
    """Walk the `attributes` list for a given key."""
    for a in catalog_item.get("attributes") or []:
        if (a.get("key") or "").lower() == key.lower():
            return a.get("value")
    return None


def _extract_image(catalog_item: dict) -> str | None:
    """Costco product images live under several possible keys. Return the
    first URL that looks like a real image."""
    # Direct keys
    for k in ("imageUrl", "image", "primaryImageURL", "mainImage"):
        v = catalog_item.get(k)
        if isinstance(v, str) and v.startswith("http"):
            return v
    # Attributes may contain an image URL
    for a in catalog_item.get("attributes") or []:
        for k in ("PrimaryImage", "Image", "ImageUrl", "ImageURL"):
            if (a.get("key") or "").lower() == k.lower():
                v = a.get("value")
                if isinstance(v, str) and v.startswith("http"):
                    return v
    return None


def _extract_product_url(catalog_item: dict) -> str | None:
    """Costco product URL: /.product.{itemId}.html (guessed pattern)."""
    # Sometimes under catalogData.productURL
    for k in ("productURL", "productUrl", "url"):
        v = catalog_item.get(k)
        if isinstance(v, str) and v.startswith("http"):
            return v
        if isinstance(v, str) and v.startswith("/"):
            return f"https://www.costco.ca{v}"
    # Build from itemId if present
    item_id = catalog_item.get("itemId")
    if item_id:
        name = (_extract_attr(catalog_item, "ProductName") or "").strip().lower()
        slug = re.sub(r"[^a-z0-9]+", "-", name).strip("-")[:60] or "product"
        return f"https://www.costco.ca/.product.{item_id}.html"
    return None


def _extract_format(catalog_item: dict) -> tuple[float, str]:
    """Best-effort parsing of the package format."""
    # Try a few common attribute keys
    for key in ("ItemWeight", "NetWeight", "ItemNetContent", "Size", "Unit Size"):
        v = _extract_attr(catalog_item, key)
        if v:
            fmt = parse_format(str(v))
            if fmt.get("qty"):
                return fmt["qty"], fmt["unit"]
    # fall back to parsing the product name
    name = _extract_attr(catalog_item, "ProductName") or catalog_item.get("ProductName") or ""
    fmt = parse_format(name) if name else {"qty": 1.0, "unit": "unite"}
    return fmt.get("qty") or 1.0, fmt.get("unit") or "unite"


async def _warm_up(page) -> None:
    """Load homepage, accept cookies, remove OneTrust, select Quebec warehouse."""
    ctx_id = id(page.context)
    if ctx_id in _WARMED:
        return
    try:
        await page.goto("https://www.costco.ca/", wait_until="domcontentloaded", timeout=40000)
        await page.wait_for_timeout(4000)
        await try_accept_cookies(page)
        await page.evaluate(
            "document.querySelector('#onetrust-consent-sdk')?.remove();"
            "document.querySelectorAll('[class*=OnetrustBanner]').forEach(e => e.remove());"
        )
        await page.wait_for_timeout(1500)
        _WARMED.add(ctx_id)
    except Exception as e:
        logger.warning(f"Costco warm-up: {e}")


def _install_graphql_listener(page) -> tuple[asyncio.Future, callable]:
    """Install the response listener IMMEDIATELY (synchronously) and return
    the future + remove-listener callable. Caller does page.goto() then
    awaits the future."""
    loop = asyncio.get_event_loop()
    captured: asyncio.Future = loop.create_future()

    async def _on_response(resp):
        if captured.done():
            return
        if GRAPHQL_URL not in resp.url:
            return
        if resp.status != 200:
            return
        try:
            body = await resp.text()
        except Exception:
            return
        if "catalogData" not in body:
            return
        try:
            data = json.loads(body)
            items = (data.get("data", {}).get("products", {}) or {}).get("catalogData") or []
            if items and not captured.done():
                captured.set_result(items)
        except Exception:
            pass

    def _listener(r):
        asyncio.create_task(_on_response(r))

    page.on("response", _listener)

    def _remove():
        try:
            page.remove_listener("response", _listener)
        except Exception:
            pass

    return captured, _remove


async def search_costco(page, query: str, store_id: str | None = None) -> dict | None:
    """Search Costco.ca for one ingredient, returning a scraper dict or None.

    Matches the contract of `app/scrapers/maxi.py::search_maxi` so
    `map_prices.py` can call either interchangeably.
    """
    key = query.lower().strip()
    if key in _SEARCH_CACHE:
        cached = _SEARCH_CACHE[key]
        if not cached:
            return None
        # skip warm-up, re-extract below
        items = cached
    else:
        await _warm_up(page)
        search_url = f"https://www.costco.ca/s?dept=All&keyword={urllib.parse.quote(query)}"

        # Attach the listener SYNCHRONOUSLY before navigation — the GraphQL
        # POST fires very early during page render.
        future, remove_listener = _install_graphql_listener(page)
        try:
            await page.goto(search_url, wait_until="domcontentloaded", timeout=40000)
            # Scroll to force any lazy product rows
            try:
                await page.wait_for_timeout(2500)
                await page.evaluate("window.scrollBy(0, 1200)")
                await page.wait_for_timeout(1500)
            except Exception:
                pass
            try:
                items = await asyncio.wait_for(future, timeout=25.0)
            except asyncio.TimeoutError:
                items = []
        except Exception as e:
            logger.warning(f"Costco search goto '{query}': {e}")
            items = []
        finally:
            remove_listener()
        _SEARCH_CACHE[key] = items

    if not items:
        logger.warning(f"Costco API: no GraphQL products for '{query}'")
        return None

    # normalise each item to (name, price, url, image, format_qty, format_unit)
    scored: list[dict] = []
    for it in items:
        if not it.get("buyable"):
            continue
        name = _extract_attr(it, "ProductName") or it.get("ProductName") or ""
        if not name or len(name) < 3:
            continue
        price = _extract_price(it)
        if price is None:
            continue
        fq, fu = _extract_format(it)
        scored.append({
            "name": name,
            "brand": _extract_attr(it, "Brand"),
            "price": price,
            "product_url": _extract_product_url(it),
            "image_url": _extract_image(it),
            "format_qty": fq,
            "format_unit": fu,
        })

    relevant = [p for p in scored if is_relevant(query, p["name"])]
    if not relevant:
        logger.warning(f"Costco API: none of {len(scored)} items match '{query}'")
        return None

    best = min(relevant, key=lambda p: p["price"])

    # HEAD-verify image; fall back to OFF if the direct URL is dead
    nutrition = await fetch_nutrition_openfoodfacts(query)
    final_image = best.get("image_url")
    if final_image:
        try:
            async with httpx.AsyncClient(timeout=4.0) as c:
                r = await c.head(final_image, follow_redirects=True)
                if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
                    final_image = None
        except Exception:
            final_image = None
    if not final_image:
        final_image = nutrition.pop("off_image_url", None)
    else:
        nutrition.pop("off_image_url", None)

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
