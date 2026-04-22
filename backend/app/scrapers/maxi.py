"""
Scraper Maxi — extraction DOM via data-testid attributes (Chakra UI / Next.js).
"""
import logging
import urllib.parse

from app.scrapers._utils import (
    is_relevant,
    parse_format,
    fetch_nutrition_openfoodfacts,
    try_accept_cookies,
)

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

            const rawPrice = priceEl ? priceEl.innerText.trim() : '';
            const m = rawPrice.match(/(\d+[.,]\d{2})/);
            const price = m ? parseFloat(m[1].replace(',', '.')) : null;

            const size = sizeEl ? sizeEl.innerText.trim() : '';
            const brand = brandEl ? brandEl.innerText.trim() : '';
            const link = linkEl ? linkEl.href : '';

            if (price && price > 0 && price < 200) {
                results.push({ name, price, link, size, brand });
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

    return {
        "store": "maxi",
        "product_name": best["name"],
        "brand": best.get("brand"),
        "price": best["price"],
        "product_url": best.get("link") or search_url,
        "format_qty": fmt["qty"],
        "format_unit": fmt["unit"],
        "package_size_raw": size_str,
        **nutrition,
    }
