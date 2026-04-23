"""
Scraper Costco.ca — bypasses Akamai via patchright + homepage warm-up.

Key findings:
- Direct `/s?keyword=...` fails with HTTP2_PROTOCOL_ERROR or "Access Denied" when
  hit cold. Must navigate to homepage first to get Akamai session cookies set.
- Headless Chrome is blocked at homepage, so the shared browser context used for
  Costco must be launched headful (via patchright). See map_prices.py / import_marmiton.py.
- Search results are Next.js tiles: each `a[href*=".product."]` lives directly in
  a container whose innerText has: "<name>\n<brand>\n$<price>\n..."
"""
import logging
import urllib.parse

from app.config import settings
from app.scrapers._utils import (
    is_relevant,
    parse_format,
    fetch_nutrition_openfoodfacts,
    try_accept_cookies,
)

logger = logging.getLogger(__name__)

_WARMED_CONTEXTS: set[int] = set()


async def _already_on_target_warehouse(context) -> bool:
    """Cheap cookie check to avoid re-selecting the warehouse on every call.

    Costco stores the active warehouse in the STORELOCATION cookie as JSON:
        {"storeLocation": {"city": "Quebec", "zip": "G2J 1E3"}}
    The legacy `invCheck*` cookies are seeded from IP geo and never update
    via the drawer flow — do not rely on them.
    """
    try:
        import json
        import urllib.parse

        cookies = {c["name"]: c["value"] for c in await context.cookies()}
    except Exception:
        return False
    raw = cookies.get("STORELOCATION", "")
    if not raw:
        return False
    try:
        data = json.loads(urllib.parse.unquote(raw))
    except Exception:
        return False
    zip_code = (data.get("storeLocation", {}).get("zip") or "").replace(" ", "").upper()
    target = settings.COSTCO_POSTAL_CODE.replace(" ", "").upper()
    return zip_code == target


async def _select_warehouse(page) -> bool:
    """Select the configured Costco warehouse via postal code.

    Flow (reverse-engineered from costco.ca MUI WarehouseDrawer):
        1. Click "Set My Warehouse" in the header (opens the drawer).
        2. Fill the Autocomplete input with the postal code.
        3. Click the autocomplete option (the postal suggestion) — this
           triggers the search and shows a list of nearby warehouses.
        4. Click the warehouse whose name matches COSTCO_WAREHOUSE_NAME_HINT.
        5. Click "Set as My Warehouse" to confirm.

    Idempotent: no-op if cookies already point at the right postal code.
    Returns True on success. Any DOM mismatch logs a warning but never raises —
    the scraper still works with the default warehouse, just with different
    prices/availability.
    """
    if await _already_on_target_warehouse(page.context):
        return True

    postal = settings.COSTCO_POSTAL_CODE
    hint = settings.COSTCO_WAREHOUSE_NAME_HINT.lower()

    try:
        # 1. Open the "Find a Warehouse" drawer. Stable testid first, text fallback.
        try:
            await page.click(
                '[data-testid="Button_locationselector_WarehouseSelector--submit"]',
                timeout=5000,
            )
        except Exception:
            trigger_js = r"""() => {
                const els = Array.from(document.querySelectorAll('button, a, [role="button"]'));
                const hit = els.find(e => /set my warehouse|find a warehouse|mon entrep/i.test((e.innerText||'').trim()) && e.offsetParent !== null);
                if (hit) { hit.click(); return true; }
                return false;
            }"""
            if not await page.evaluate(trigger_js):
                logger.warning("Costco: 'Set My Warehouse' trigger not found")
                return False

        # 2. Wait for drawer + fill postal code + click Find button.
        # (The MUI Autocomplete typed value ends up like "G2J 1E3 Québec, Quebec"
        # after submitting via Find; clicking Find triggers the proximity search.)
        await page.wait_for_selector('[data-testid="WarehouseDrawer"]', timeout=10000)
        box = page.locator('[data-testid="WarehouseDrawer"] input[name="City, Province, or Postal Code"]').first
        await box.click()
        await page.keyboard.type(postal, delay=120)
        await page.wait_for_timeout(2000)
        await page.click('[data-testid="Button_warehousedrawer-submit"]')

        # 3. Wait for proximity results to replace the pre-cached Montreal list.
        # Costco pins the current preferred warehouse at index 0, so the signal
        # we poll for is the presence of a Quebec-region warehouse name anywhere.
        try:
            await page.wait_for_function(
                r"""() => {
                    const d = document.querySelector('[data-testid="WarehouseDrawer"]');
                    if (!d) return false;
                    const links = Array.from(d.querySelectorAll('a[data-testid="Link"]')).map(a => (a.innerText||'').trim());
                    return links.some(t => /^(Quebec|Sainte Foy|Levis)$/i.test(t));
                }""",
                timeout=20000,
            )
        except Exception:
            logger.warning(
                f"Costco: results didn't update to Quebec-region warehouses for postal {postal}"
            )
            return False

        # 4. Pick the first card whose warehouse name matches the hint.
        # Costco pins the currently-preferred warehouse at index 0 (e.g. Anjou
        # for Montreal IPs), so we must not blindly click the first button —
        # we walk the tiles and match by name.
        picked = await page.evaluate(
            r"""(hint) => {
              const drawer = document.querySelector('[data-testid="WarehouseDrawer"]');
              if (!drawer) return null;
              // Each tile has a Link (warehouse name) + Set-as-preferred button.
              // Find all links, for each one walk to the enclosing tile and
              // check for a Set-as-preferred button.
              const links = Array.from(drawer.querySelectorAll('a[data-testid="Link"]'));
              // Exact match first (case-insensitive), then substring fallback —
              // so "Quebec" matches "Quebec" not "Quebec City Business Centre".
              const exact = links.find(l => (l.innerText||'').trim().toLowerCase() === hint);
              const ordered = exact ? [exact, ...links.filter(l => l !== exact)] : links;
              for (const link of ordered) {
                const name = (link.innerText||'').trim();
                if (!name.toLowerCase().includes(hint)) continue;
                // Walk up to find the tile containing this link + its button
                let tile = link;
                for (let i = 0; i < 8; i++) {
                    tile = tile.parentElement;
                    if (!tile) break;
                    const btn = tile.querySelector('[data-testid="Button_warehousetile-setwarehouse-as-preferred"]');
                    if (btn) {
                        btn.scrollIntoView({block: 'center'});
                        btn.click();
                        return name;
                    }
                }
              }
              return null;
            }""",
            hint,
        )
        if not picked:
            logger.warning(
                f"Costco: no warehouse card matching '{hint}' for postal {postal}"
            )
            return False
        logger.info(f"Costco: picked warehouse '{picked}' for postal {postal}")
        await page.wait_for_timeout(1500)

        # 5. Handle any confirmation modal ("Are you sure you want to change...")
        try:
            confirm_js = r"""() => {
              // Look for a visible dialog other than the warehouse drawer
              const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]'))
                .filter(d => d.getAttribute('data-testid') !== 'WarehouseDrawer' && d.offsetParent !== null);
              for (const d of dialogs) {
                  const btn = Array.from(d.querySelectorAll('button')).find(b =>
                      /yes|confirm|continue|ok|set|changer|continuer/i.test((b.innerText||'').trim()));
                  if (btn) { btn.click(); return (btn.innerText||'').trim(); }
              }
              return null;
            }"""
            confirmed = await page.evaluate(confirm_js)
            if confirmed:
                logger.info(f"Costco: confirmation dialog -> clicked '{confirmed}'")
                await page.wait_for_timeout(2500)
        except Exception:
            pass
        await page.wait_for_timeout(2000)

        if await _already_on_target_warehouse(page.context):
            logger.info(f"Costco: warehouse set to '{hint}' (postal {postal})")
            return True
        logger.warning(f"Costco: warehouse picked but cookies did not update (text='{picked[:80]}')")
        return False
    except Exception as e:
        logger.warning(f"Costco warehouse selection failed: {e}")
        return False


async def _warm_up(page) -> None:
    """Load costco.ca homepage once per browser context to get Akamai cookies
    AND select the configured warehouse (Bouvier, Québec by default)."""
    ctx_id = id(page.context)
    if ctx_id in _WARMED_CONTEXTS:
        return
    try:
        await page.goto("https://www.costco.ca/", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(3500)
        await try_accept_cookies(page)
        await _select_warehouse(page)
        _WARMED_CONTEXTS.add(ctx_id)
    except Exception as e:
        logger.warning(f"Costco warm-up failed: {e}")


async def search_costco(page, query: str, store_id: str | None = None) -> dict | None:
    """Search Costco.ca for one ingredient. Returns best matching product or None."""
    await _warm_up(page)

    search_url = (
        f"https://www.costco.ca/s?dept=All&keyword={urllib.parse.quote(query)}"
    )
    try:
        await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
    except Exception as e:
        logger.warning(f"Costco: goto failed for '{query}': {e}")
        return None

    # Wait for tiles to hydrate
    try:
        await page.wait_for_selector('a[href*=".product."]', timeout=10000)
    except Exception:
        pass
    await page.wait_for_timeout(1500)

    _js = r"""() => {
        const results = [];
        const links = Array.from(document.querySelectorAll('a[href*=".product."]')).slice(0, 30);
        const seen = new Set();
        for (const a of links) {
            const href = a.href;
            if (!href || seen.has(href)) continue;
            seen.add(href);

            const name = (a.innerText || '').trim();
            if (!name || name.length < 3) continue;

            // Immediate parent typically holds the full tile text (name, brand, price)
            let tile = a.parentElement;
            let tileText = tile ? (tile.innerText || '') : '';
            // Walk up a couple of levels if price not found yet
            for (let i = 0; i < 3 && !/\$\d/.test(tileText); i++) {
                if (!tile || !tile.parentElement) break;
                tile = tile.parentElement;
                tileText = tile.innerText || '';
            }

            const priceMatch = tileText.match(/\$(\d+(?:[.,]\d{2}))/);
            const price = priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : null;

            // Brand: the line immediately after the product name, if not a price
            const lines = tileText.split('\n').map(l => l.trim()).filter(Boolean);
            let brand = '';
            const nameIdx = lines.findIndex(l => l === name);
            if (nameIdx >= 0 && nameIdx + 1 < lines.length) {
                const next = lines[nameIdx + 1];
                if (!/^\$/.test(next) && next.length < 40) brand = next;
            }

            // Thumbnail image: look inside tile (a > img, or sibling img)
            let image = '';
            const imgEl = (tile || a).querySelector('img[src]');
            if (imgEl) image = imgEl.currentSrc || imgEl.src;

            if (price && price > 0 && price < 1500) {
                results.push({ name, price, link: href, brand, image });
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
        logger.warning(
            f"Costco: no relevant match for '{query}' among {len(raw_products)} products"
        )
        return None

    best = min(relevant, key=lambda p: p["price"])
    fmt = parse_format(best["name"])

    if best["price"] > 500:
        logger.warning(f"Costco: price too high ({best['price']}$) for '{query}'")
        return None

    nutrition = await fetch_nutrition_openfoodfacts(query)
    logger.info(
        f"Costco OK '{query}' -> {best.get('brand','')} {best['name']} | "
        f"{best['price']}$ ({fmt['qty']} {fmt['unit']})"
    )

    scraped_img = best.get("image") or ""
    is_valid_img = scraped_img and ("jpg" in scraped_img.lower() or "png" in scraped_img.lower() or "webp" in scraped_img.lower())
    image_url = scraped_img if is_valid_img else nutrition.pop("off_image_url", None) or None

    return {
        "store": "costco",
        "product_name": best["name"],
        "brand": best.get("brand"),
        "price": best["price"],
        "product_url": best.get("link") or search_url,
        "image_url": image_url,
        "format_qty": fmt["qty"],
        "format_unit": fmt["unit"],
        **nutrition,
    }
