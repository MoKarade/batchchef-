"""
Scraper Maxi — extraction DOM après networkidle (Next.js CSR).
Stratégie : h3[nom produit] + parent.querySelector('[class*=price]')
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
    `page` is a Playwright async Page object already in a browser context.
    """
    search_url = (
        f"https://www.maxi.ca/fr/recherche"
        f"?recherche={urllib.parse.quote(query)}&magasinId={store_id}"
    )

    try:
        await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
    except Exception:
        pass

    await try_accept_cookies(page)

    try:
        await page.wait_for_selector("h3", timeout=8000)
    except Exception:
        pass

    _js = r"""() => {
        const results = [];
        const h3s = Array.from(document.querySelectorAll('h3'));

        for (const h3 of h3s.slice(0, 30)) {
            const name = h3.innerText.trim();
            if (!name || name.length < 3) continue;

            let container = h3;
            let priceEl = null;
            for (let i = 0; i < 6; i++) {
                container = container.parentElement;
                if (!container) break;
                priceEl = container.querySelector('[class*="price"],[data-testid*="price"],[itemprop="price"]');
                if (priceEl) break;
            }

            let link = '';
            if (container) {
                const a = container.querySelector('a[href]') || h3.closest('a');
                link = a ? a.href : '';
            }

            const rawPrice = priceEl ? priceEl.innerText.trim() : '';
            const m = rawPrice.match(/(\d+[.,]\d{2})/);
            const price = m ? parseFloat(m[1].replace(',', '.')) : null;

            if (name && price && price > 0 && price < 200) {
                results.push({ name, price, link });
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
    fmt = parse_format(best["name"])

    if best["price"] > 75:
        logger.warning(f"Maxi: price too high ({best['price']}$) for '{query}'")
        return None

    nutrition = await fetch_nutrition_openfoodfacts(query)
    logger.info(f"Maxi OK '{query}' -> {best['name']} | {best['price']}$ ({fmt['qty']} {fmt['unit']})")

    return {
        "store": "maxi",
        "product_name": best["name"],
        "price": best["price"],
        "product_url": best.get("link") or search_url,
        "format_qty": fmt["qty"],
        "format_unit": fmt["unit"],
        **nutrition,
    }
