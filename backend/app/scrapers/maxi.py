"""
Scraper Maxi — extraction DOM via data-testid attributes (Chakra UI / Next.js).
"""
import logging
import re
import urllib.parse

from app.scrapers._utils import (
    is_relevant,
    parse_format,
    fetch_nutrition_openfoodfacts,
    try_accept_cookies,
)

# Maxi/Loblaws SKU → CDN image URL. SKUs appear as "{11digits}_EA" in product URLs.
_SKU_RE = re.compile(r"/p/(\d{9,13})(?:_\w+)?", re.I)


def _maxi_image_from_url(product_url: str | None) -> str | None:
    """Build the CDN image URL from the product page URL's SKU.

    Pattern (verified 2026-04): assets.shop.loblaws.ca/products/{SKU}/b1/en/front/{SKU}_front_a01_@2.png
    Returns None if no SKU could be extracted.
    """
    if not product_url:
        return None
    m = _SKU_RE.search(product_url)
    if not m:
        return None
    sku = m.group(1)
    return f"https://assets.shop.loblaws.ca/products/{sku}/b1/en/front/{sku}_front_a01_%402.png"

logger = logging.getLogger(__name__)


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

    if best["price"] > 75:
        logger.warning(f"Maxi: price too high ({best['price']}$) for '{query}'")
        return None

    nutrition = await fetch_nutrition_openfoodfacts(query)
    logger.info(
        f"Maxi OK '{query}' -> {best.get('brand','')} {best['name']} | "
        f"{best['price']}$ ({fmt['qty']} {fmt['unit']} from '{size_str}')"
    )

    # Image sources, in order of preference:
    #   1. Deterministic CDN URL built from the product's SKU (always present on Maxi)
    #   2. DOM <img> if it's a real CDN image (not a search-page placeholder)
    #   3. OpenFoodFacts fallback (generic product image)
    product_url_full = best.get("link") or search_url
    cdn_img = _maxi_image_from_url(product_url_full)
    scraped_img = best.get("image") or ""
    is_valid_scraped = (
        scraped_img
        and ("jpg" in scraped_img.lower() or "png" in scraped_img.lower() or "webp" in scraped_img.lower())
        and "search" not in scraped_img
    )
    image_url = cdn_img or (scraped_img if is_valid_scraped else None) or nutrition.pop("off_image_url", None)

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
