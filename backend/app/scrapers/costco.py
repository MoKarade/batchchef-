"""
Scraper Costco.ca — DOM extraction via product grid.
Strategy: `.product-tile` / `[automation-id="productList"]` fallback to any heading+price pair.
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


async def search_costco(page, query: str, store_id: str | None = None) -> dict | None:
    """
    Search Costco.ca for one ingredient. Returns best matching product or None.
    `page` is a Playwright async Page object already in a browser context.
    """
    search_url = (
        f"https://www.costco.ca/CatalogSearch?dept=All&keyword="
        f"{urllib.parse.quote(query)}&langId=-24"
    )

    try:
        await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
    except Exception:
        pass

    await try_accept_cookies(page)

    # Costco.ca uses SSR + hydration. Wait for either product tile or empty state.
    try:
        await page.wait_for_selector(
            "[automation-id='productList'], .product-tile, .no-results",
            timeout=8000,
        )
    except Exception:
        pass

    _js = r"""() => {
        const results = [];
        // Costco grid tiles
        const tiles = Array.from(document.querySelectorAll(
            '[automation-id="productList"] > div, .product-tile, article[class*="product"]'
        )).slice(0, 30);

        for (const tile of tiles) {
            const nameEl = tile.querySelector(
                '[automation-id*="productDescription"], .description, span[class*="description"], a.description, h3, h2'
            );
            const priceEl = tile.querySelector(
                '[automation-id*="productPrice"], .price, [class*="price-block"] [class*="value"], [class*="price"]'
            );
            const linkEl = tile.querySelector('a[href]');

            const name = nameEl ? nameEl.innerText.trim() : '';
            const rawPrice = priceEl ? priceEl.innerText.trim() : '';
            if (!name || name.length < 3) continue;

            const m = rawPrice.match(/(\d+[.,]\d{2})/);
            const price = m ? parseFloat(m[1].replace(',', '.')) : null;
            const link = linkEl ? linkEl.href : '';

            if (name && price && price > 0 && price < 1000) {
                results.push({ name, price, link });
            }
        }

        // Fallback: heading+price heuristic
        if (results.length === 0) {
            const headings = Array.from(document.querySelectorAll('h2, h3'));
            for (const h of headings.slice(0, 30)) {
                const name = h.innerText.trim();
                if (!name || name.length < 3) continue;
                let container = h;
                let priceEl = null;
                for (let i = 0; i < 6; i++) {
                    container = container.parentElement;
                    if (!container) break;
                    priceEl = container.querySelector('[class*="price"]');
                    if (priceEl) break;
                }
                const rawPrice = priceEl ? priceEl.innerText.trim() : '';
                const m = rawPrice.match(/(\d+[.,]\d{2})/);
                const price = m ? parseFloat(m[1].replace(',', '.')) : null;
                const linkEl = (container && container.querySelector('a[href]')) || h.closest('a');
                const link = linkEl ? linkEl.href : '';
                if (name && price && price > 0 && price < 1000) {
                    results.push({ name, price, link });
                }
            }
        }

        return results;
    }"""
    raw_products: list[dict] = await page.evaluate(_js)

    if not raw_products:
        logger.warning(f"Costco: no DOM products for '{query}'")
        return None

    relevant = [p for p in raw_products if is_relevant(query, p["name"])]
    if not relevant:
        logger.warning(f"Costco: no relevant match for '{query}' among {len(raw_products)} products")
        return None

    # Costco usually only sells bulk — prefer the cheapest unit-price by format
    best = min(relevant, key=lambda p: p["price"])
    fmt = parse_format(best["name"])

    # Costco multipacks can legitimately exceed $100 — allow up to 500$
    if best["price"] > 500:
        logger.warning(f"Costco: price too high ({best['price']}$) for '{query}'")
        return None

    nutrition = await fetch_nutrition_openfoodfacts(query)
    logger.info(f"Costco OK '{query}' -> {best['name']} | {best['price']}$ ({fmt['qty']} {fmt['unit']})")

    return {
        "store": "costco",
        "product_name": best["name"],
        "price": best["price"],
        "product_url": best.get("link") or search_url,
        "format_qty": fmt["qty"],
        "format_unit": fmt["unit"],
        **nutrition,
    }
