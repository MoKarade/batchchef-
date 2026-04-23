"""
Scraper Maxi — extraction DOM via data-testid attributes (Chakra UI / Next.js).
"""
import logging
import re
import urllib.parse

import httpx

from app.scrapers._utils import (
    is_relevant,
    parse_format,
    fetch_nutrition_openfoodfacts,
    try_accept_cookies,
)

# Maxi/Loblaws SKU → CDN image URL. SKUs appear as "{11digits}_EA" in product URLs.
_SKU_RE = re.compile(r"/p/(\d{9,13})(?:_\w+)?", re.I)


_IMAGE_URL_CACHE: dict[str, str | None] = {}  # sku -> verified URL or None


def _build_loblaws_cdn_urls(sku: str) -> list[str]:
    """Candidate CDN paths to try in order. Different products live under
    slightly different suffixes (_front_a01_@2.png vs _front_a1a.png)."""
    return [
        f"https://assets.shop.loblaws.ca/products/{sku}/b1/en/front/{sku}_front_a01_%402.png",
        f"https://assets.shop.loblaws.ca/products/{sku}/b2/fr/front/{sku}_front_a01_%402.png",
        f"https://assets.shop.loblaws.ca/products/{sku}/b1/en/front/{sku}_front_a1a.png",
        f"https://assets.shop.loblaws.ca/products/{sku}/b1/en/front/{sku}_front_a1c1.png",
    ]


async def _verify_image(url: str, client: httpx.AsyncClient) -> bool:
    """Quick HEAD request: returns True only if the URL 200s AND content-type
    is an image. Avoids storing 403/404 URLs that waste a DOM <img> slot."""
    try:
        r = await client.head(url, timeout=4.0, follow_redirects=True)
        if r.status_code != 200:
            return False
        ctype = r.headers.get("content-type", "")
        return ctype.startswith("image/")
    except Exception:
        return False


async def _scrape_og_image(product_url: str, client: httpx.AsyncClient) -> str | None:
    """3rd-tier fallback: fetch the product page and extract <meta property="og:image">.
    Loblaws always sets this to a usable image URL, and it bypasses the CDN
    path-guessing entirely. Slower (one full page fetch) but nearly 100% reliable.
    """
    try:
        r = await client.get(
            product_url,
            timeout=8.0,
            follow_redirects=True,
            headers={"user-agent": "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36"},
        )
        if r.status_code != 200:
            return None
        html = r.text
        # <meta property="og:image" content="https://..."/>
        import re as _re
        m = _re.search(
            r'<meta\s+property=["\']og:image["\']\s+content=["\']([^"\']+)["\']',
            html,
            _re.IGNORECASE,
        )
        if not m:
            # Try reversed attribute order
            m = _re.search(
                r'<meta\s+content=["\']([^"\']+)["\']\s+property=["\']og:image["\']',
                html,
                _re.IGNORECASE,
            )
        if m:
            url = m.group(1).strip()
            if url.startswith("http") and await _verify_image(url, client):
                return url
    except Exception:
        pass
    return None


async def _resolve_loblaws_image(product_url: str | None) -> str | None:
    """Resolve a product image in 3 tiers:
      1. Loblaws CDN path-guessing (fastest, ~55% hit rate)
      2. og:image scrape of the product page (slower, ~90%+ hit rate)
      3. None

    Result cached per-SKU for the process lifetime so we don't HEAD the same
    URL every time the same ingredient is rescanned.
    """
    if not product_url:
        return None
    m = _SKU_RE.search(product_url)
    if not m:
        return None
    sku = m.group(1)
    if sku in _IMAGE_URL_CACHE:
        return _IMAGE_URL_CACHE[sku]

    async with httpx.AsyncClient(timeout=6.0) as client:
        # Tier 1: CDN path-guessing
        for candidate in _build_loblaws_cdn_urls(sku):
            if await _verify_image(candidate, client):
                _IMAGE_URL_CACHE[sku] = candidate
                return candidate
        # Tier 2: scrape og:image from product page
        og = await _scrape_og_image(product_url, client)
        if og:
            _IMAGE_URL_CACHE[sku] = og
            return og

    _IMAGE_URL_CACHE[sku] = None
    return None


def _maxi_image_from_url(product_url: str | None) -> str | None:
    """Legacy synchronous version — returns the first candidate without
    verifying. Kept for callers that don't want to await; prefer
    `_resolve_loblaws_image` when possible."""
    if not product_url:
        return None
    m = _SKU_RE.search(product_url)
    if not m:
        return None
    sku = m.group(1)
    return _build_loblaws_cdn_urls(sku)[0]

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pack-size parser — reparse a Maxi product name when the DOM gave us a
# useless (1, unite) pair. Shared with scripts/fix_unite_format.py.
# ---------------------------------------------------------------------------
def _parse_pack_from_name(name: str, canonical_hint: str = "") -> tuple[float, str] | None:
    n = (name or "").lower()
    hint = (canonical_hint or "").lower()

    # Multi-pack: "6×250 g", "24 x 33 g", "pack de 6 — 500 ml"
    m = re.search(r"(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|cl)\b", n)
    if m:
        count = int(m.group(1))
        per = float(m.group(2).replace(",", "."))
        unit = m.group(3)
        if unit == "cl":
            per, unit = per * 10, "ml"
        return count * per, unit

    # Explicit dozen / egg-specific: douzaine, 12 œufs, dozen
    if re.search(r"douzaine|dozen|\b12\s*(?:œuf|oeuf|eggs?|unit)", n):
        return 12.0, "unite"

    # Eggs with no explicit count default to a dozen (the Maxi default SKU)
    if (
        ("œuf" in n or "oeuf" in n)
        and ("œuf" in hint or "oeuf" in hint or hint == "")
        and not re.search(r"\b1\s*(?:œuf|oeuf)\b", n)
    ):
        m = re.search(r"\b(\d{1,2})\s*(?:œufs?|oeufs?|unit)", n)
        if m:
            n_eggs = int(m.group(1))
            if 4 <= n_eggs <= 30:
                return float(n_eggs), "unite"
        return 12.0, "unite"

    # "pack/paquet/boîte de N (unités|œufs|muffins|…)"
    m = re.search(
        r"(?:pack|paquet|bo[iî]te|ensemble|emballage)\s*(?:de|d')?\s*(\d+)\s*(?:unit(?:e|é)s?|pi[eè]ces?|œufs?|oeufs?|muffins?|pains?|tranches?|saucisses?|croissants?)?",
        n,
    )
    if m:
        return float(m.group(1)), "unite"

    # "N unité(s) | pièces | ct | count"
    m = re.search(r"\b(\d+)\s*(?:unit(?:e|é)s?|pi[eè]ces?|pcs?|ct|count)\b", n)
    if m:
        count = int(m.group(1))
        if 2 <= count <= 100:
            return float(count), "unite"

    # Mass in package (typical Maxi suffix)
    m = re.search(r"\b(\d+(?:[.,]\d+)?)\s*(kg|g)\b", n)
    if m:
        qty = float(m.group(1).replace(",", "."))
        unit = m.group(2)
        if (unit == "g" and 20 <= qty <= 5000) or (unit == "kg" and 0.1 <= qty <= 20):
            return qty, unit

    # Volume
    m = re.search(r"\b(\d+(?:[.,]\d+)?)\s*(ml|l)\b", n)
    if m:
        qty = float(m.group(1).replace(",", "."))
        unit = m.group(2)
        if (unit == "ml" and 50 <= qty <= 5000) or (unit == "l" and 0.1 <= qty <= 20):
            return qty, unit

    return None


async def search_maxi(page, query: str, store_id: str = "8676") -> dict | None:
    """
    Search Maxi for one ingredient. Returns best matching product or None.
    Extracts name, price, package size, brand via data-testid selectors.
    """
    search_url = (
        f"https://www.maxi.ca/fr/search"
        f"?search-bar={urllib.parse.quote(query)}&storeId={store_id}"
    )

    try:
        await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
    except Exception:
        pass

    await try_accept_cookies(page)

    try:
        await page.wait_for_selector("[data-testid='product-title']", timeout=8000)
    except Exception:
        pass

    _js = r"""() => {
        const results = [];
        const titles = Array.from(document.querySelectorAll('[data-testid="product-title"]')).slice(0, 30);

        for (const titleEl of titles) {
            const name = titleEl.innerText.trim();
            if (!name || name.length < 3) continue;

            // Walk up to find the product tile container
            let container = titleEl;
            for (let i = 0; i < 10; i++) {
                if (!container.parentElement) break;
                container = container.parentElement;
                if (container.querySelector('[data-testid="regular-price"],[data-testid="sale-price"],[data-testid="price-product-tile"]')) break;
            }

            const priceEl = container.querySelector(
                '[data-testid="sale-price"], [data-testid="regular-price"]'
            );
            const sizeEl = container.querySelector('[data-testid="product-package-size"]');
            const brandEl = container.querySelector('[data-testid="product-brand"]');
            const linkEl = container.querySelector('a[href][class*="linkbox"],a[href*="/p/"]');
            const imgEl = container.querySelector('img[src]');

            const rawPrice = priceEl ? priceEl.innerText.trim() : '';
            const m = rawPrice.match(/(\d+[.,]\d{2})/);
            const price = m ? parseFloat(m[1].replace(',', '.')) : null;

            const size = sizeEl ? sizeEl.innerText.trim() : '';
            const brand = brandEl ? brandEl.innerText.trim() : '';
            const link = linkEl ? linkEl.href : '';
            const image = imgEl ? (imgEl.currentSrc || imgEl.src) : '';

            if (price && price > 0 && price < 200) {
                results.push({ name, price, link, size, brand, image });
            }
        }
        return results;
    }"""
    raw_products: list[dict] = await page.evaluate(_js)

    if not raw_products:
        logger.warning(f"Maxi: no DOM products for '{query}'")
        return None

    relevant = [p for p in raw_products if is_relevant(query, p["name"])]
    if not relevant:
        logger.warning(f"Maxi: no relevant match for '{query}' among {len(raw_products)} products")
        return None

    best = min(relevant, key=lambda p: p["price"])

    # Prefer the real size string from DOM (e.g. "2 kg", "500 ml"); fall back to parsing the name
    size_str = best.get("size") or ""
    fmt = parse_format(size_str) if size_str else parse_format(best["name"])
    if fmt["unit"] == "unite" and size_str:
        fmt = parse_format(best["name"])

    # Pack-size sanity override: when we end up with qty=1, unit=unite, the
    # product name often still encodes the real pack size (douzaine, 12 œufs,
    # pack de 6, etc.). If our heuristic finds a better (qty, unit) from the
    # full name, prefer that. Fixes the recurring "31 eggs at 4.17/unit = 129$"
    # class of bug where Maxi lists the per-unit price alongside the pack.
    if fmt.get("qty") in (None, 1, 1.0) and (fmt.get("unit") in ("unite", None)):
        reparsed = _parse_pack_from_name(best["name"], query)
        if reparsed is not None:
            new_qty, new_unit = reparsed
            fmt = {"qty": new_qty, "unit": new_unit}

    if best["price"] > 75:
        logger.warning(f"Maxi: price too high ({best['price']}$) for '{query}'")
        return None

    nutrition = await fetch_nutrition_openfoodfacts(query)
    logger.info(
        f"Maxi OK '{query}' -> {best.get('brand','')} {best['name']} | "
        f"{best['price']}$ ({fmt['qty']} {fmt['unit']} from '{size_str}')"
    )

    # Image sources, in order of preference. Each is HEAD-verified so we
    # never store a 404/403 URL (common when the CDN path doesn't match the
    # product's actual suffix):
    #   1. Loblaws CDN (tried against 4 known URL patterns, HEAD-verified)
    #   2. DOM <img> from the search tile if it looks like a real image
    #   3. OpenFoodFacts fallback
    #   4. None → the UI falls back to the category emoji
    product_url_full = best.get("link") or search_url
    cdn_img = await _resolve_loblaws_image(product_url_full)
    scraped_img = best.get("image") or ""
    is_valid_scraped = (
        scraped_img
        and ("jpg" in scraped_img.lower() or "png" in scraped_img.lower() or "webp" in scraped_img.lower())
        and "search" not in scraped_img
        and "maxi.ca" not in scraped_img   # defensively drop self-links
    )
    image_url = cdn_img
    if not image_url and is_valid_scraped:
        async with httpx.AsyncClient() as _c:
            if await _verify_image(scraped_img, _c):
                image_url = scraped_img
    if not image_url:
        off = nutrition.pop("off_image_url", None)
        if off:
            async with httpx.AsyncClient() as _c:
                if await _verify_image(off, _c):
                    image_url = off

    # Last-resort: DuckDuckGo image search by product name for near-100%
    # coverage when CDN + OFF both fail.
    if not image_url:
        from app.scrapers._image_search import find_product_image
        ddg_q = f"{best['name']} maxi loblaws" if best.get("name") else query
        image_url = await find_product_image(ddg_q[:80])

    # Drop the scraper-internal OFF image field so it doesn't leak into the result
    nutrition.pop("off_image_url", None)

    return {
        "store": "maxi",
        "product_name": best["name"],
        "brand": best.get("brand"),
        "price": best["price"],
        "product_url": product_url_full,
        "image_url": image_url,
        "format_qty": fmt["qty"],
        "format_unit": fmt["unit"],
        "package_size_raw": size_str,
        **nutrition,
    }
