"""
One-shot helper: find the Maxi store ID for G1M 3E5 (Fleur-de-Lys, Québec).

Usage:
    cd backend
    uv run python scripts/find_maxi_store.py

Tries two approaches in order:
  1. HTTP (Metro/Maxi store locator APIs) — fast, no browser needed
  2. Playwright headless — intercepts XHR + reads cookies after store selection
"""
import asyncio
import json
import sys

POSTAL_CODE = "G1M3E5"
POSTAL_DISPLAY = "G1M 3E5"
STORE_HINT = "Fleur"


# ---------------------------------------------------------------------------
# Approach 1 — HTTP only
# ---------------------------------------------------------------------------

async def find_via_http() -> str | None:
    import httpx

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "fr-CA,fr;q=0.9",
        "Referer": "https://www.maxi.ca/",
    }

    candidates = [
        # Metro Group store-locator patterns (varies by year/API version)
        f"https://www.maxi.ca/en/product-catalogue/stores?postalCode={POSTAL_CODE}&lang=fr",
        f"https://www.maxi.ca/api/v1/stores?postalCode={POSTAL_CODE}",
        f"https://www.maxi.ca/store-locator/stores.json?q={POSTAL_CODE}",
        f"https://www.maxi.ca/fr/trouver-un-magasin?postalCode={POSTAL_CODE}",
    ]

    async with httpx.AsyncClient(follow_redirects=True, timeout=15, headers=headers) as client:
        for url in candidates:
            try:
                r = await client.get(url)
                print(f"  GET {url}  →  {r.status_code}")
                if r.status_code == 200:
                    try:
                        data = r.json()
                        print(json.dumps(data, indent=2, ensure_ascii=False)[:1500])
                        store_id = _extract_id(data)
                        if store_id:
                            return store_id
                    except Exception:
                        pass
            except Exception as e:
                print(f"  ERR {url}: {e}", file=sys.stderr)

    return None


def _extract_id(data) -> str | None:
    """Recursively search for a storeId / bannerId in a JSON blob."""
    if isinstance(data, dict):
        for key in ("storeId", "id", "bannerId", "locationId", "store_id"):
            val = data.get(key)
            if isinstance(val, (str, int)) and val:
                return str(val)
        for v in data.values():
            found = _extract_id(v)
            if found:
                return found
    elif isinstance(data, list):
        for item in data:
            # Prefer the Fleur-de-Lys store
            if isinstance(item, dict):
                name = str(item.get("name", "") + item.get("storeName", "") + item.get("address", ""))
                if STORE_HINT.lower() in name.lower():
                    found = _extract_id(item)
                    if found:
                        return found
        # fallback: first item
        for item in data:
            found = _extract_id(item)
            if found:
                return found
    return None


# ---------------------------------------------------------------------------
# Approach 2 — Playwright headless
# ---------------------------------------------------------------------------

async def find_via_playwright() -> str | None:
    from playwright.async_api import async_playwright

    captured_ids: list[str] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale="fr-CA",
            extra_http_headers={"Accept-Language": "fr-CA,fr;q=0.9"},
        )
        page = await context.new_page()

        async def on_response(response):
            url = response.url
            if any(k in url.lower() for k in ["store", "magasin", "banner", "location", "find"]):
                try:
                    body = await response.json()
                    print(f"\n[XHR] {url}")
                    preview = json.dumps(body, ensure_ascii=False)
                    print(preview[:600])
                    sid = _extract_id(body)
                    if sid:
                        captured_ids.append(sid)
                except Exception:
                    pass

        page.on("response", on_response)

        print("\nNavigating to maxi.ca …")
        try:
            await page.goto("https://www.maxi.ca", wait_until="domcontentloaded", timeout=30_000)
        except Exception as e:
            print(f"  goto error: {e}")
        await page.wait_for_timeout(3000)

        # Accept cookies
        try:
            for sel in ["#onetrust-accept-btn-handler", "button[id*='accept']", "button:text('Tout accepter')"]:
                btn = page.locator(sel)
                if await btn.count() > 0:
                    await btn.first.click()
                    await page.wait_for_timeout(1000)
                    break
        except Exception:
            pass

        # Click the store selector
        store_selectors = [
            "[data-testid='store-selector-button']",
            "button[aria-label*='magasin']",
            "button[aria-label*='Mon magasin']",
            "button:has-text('MON MAGASIN')",
            "button:has-text('Mon magasin')",
            "[class*='StoreSelector']",
            "[class*='store-selector']",
        ]
        clicked = False
        for sel in store_selectors:
            try:
                btn = page.locator(sel)
                if await btn.count() > 0:
                    await btn.first.click()
                    clicked = True
                    print(f"Clicked store selector: {sel}")
                    await page.wait_for_timeout(2000)
                    break
            except Exception:
                continue

        if not clicked:
            print("No store selector found — dumping page structure …")
            buttons = await page.locator("button").all()
            for b in buttons[:20]:
                try:
                    txt = await b.inner_text()
                    aria = await b.get_attribute("aria-label") or ""
                    if txt.strip() or aria.strip():
                        print(f"  btn: {repr(txt.strip()[:50])} | aria={repr(aria[:50])}")
                except Exception:
                    pass

        # Fill postal code
        postal_selectors = [
            "input[placeholder*='postal']",
            "input[placeholder*='code']",
            "input[placeholder*='Code']",
            "input[name*='postal']",
            "input[type='text']",
            "input[type='search']",
        ]
        filled = False
        for sel in postal_selectors:
            try:
                inp = page.locator(sel)
                if await inp.count() > 0:
                    await inp.first.fill(POSTAL_DISPLAY)
                    await inp.first.press("Enter")
                    filled = True
                    print(f"Filled postal code in: {sel}")
                    await page.wait_for_timeout(3000)
                    break
            except Exception:
                continue

        if not filled:
            print("Could not fill postal code input")

        # Click the Fleur-de-Lys store suggestion
        store_item_selectors = [
            "[data-testid*='store-item']",
            "[data-testid*='suggestion']",
            "li[class*='store']",
            "button[class*='store']",
            "div[class*='store-result']",
            "li",
        ]
        for sel in store_item_selectors:
            try:
                items = page.locator(sel)
                count = await items.count()
                if count > 0:
                    print(f"Found {count} items via: {sel}")
                    clicked_store = False
                    for i in range(min(count, 10)):
                        try:
                            text = await items.nth(i).inner_text()
                            print(f"  [{i}] {text.strip()[:80]}")
                            if STORE_HINT.lower() in text.lower():
                                await items.nth(i).click()
                                clicked_store = True
                                print(f"  → clicked Fleur-de-Lys store")
                                await page.wait_for_timeout(3000)
                                break
                        except Exception:
                            continue
                    if not clicked_store and count > 0:
                        try:
                            await items.first.click()
                            await page.wait_for_timeout(3000)
                        except Exception:
                            pass
                    break
            except Exception:
                continue

        # Confirm store change if dialog appears
        confirm_selectors = [
            "button:has-text('Oui')",
            "button:has-text('Modifier')",
            "button:has-text('Confirm')",
            "button:has-text('Yes')",
        ]
        for sel in confirm_selectors:
            try:
                btn = page.locator(sel)
                if await btn.count() > 0:
                    await btn.first.click()
                    print(f"Confirmed store change: {sel}")
                    await page.wait_for_timeout(2000)
                    break
            except Exception:
                continue

        # Read cookies
        cookies = await context.cookies()
        print("\n--- Cookies ---")
        for c in cookies:
            if any(k in c["name"].lower() for k in ["store", "magasin", "banner", "selected", "auto"]):
                print(f"  {c['name']} = {c['value']}")
                # Try to extract store ID from cookie value
                val = c["value"]
                try:
                    decoded = json.loads(val)
                    sid = _extract_id(decoded)
                    if sid:
                        captured_ids.append(sid)
                except Exception:
                    if val.isdigit():
                        captured_ids.append(val)

        # Try URL
        print(f"\nFinal URL: {page.url}")

        # Try localStorage
        try:
            ls = await page.evaluate("() => JSON.stringify(Object.fromEntries(Object.entries(localStorage)))")
            ls_obj = json.loads(ls)
            print("\n--- localStorage ---")
            for k, v in ls_obj.items():
                if any(hint in k.lower() for hint in ["store", "magasin", "banner"]):
                    print(f"  {k} = {v[:200]}")
                    try:
                        val_obj = json.loads(v)
                        sid = _extract_id(val_obj)
                        if sid:
                            captured_ids.append(sid)
                    except Exception:
                        if v.strip().isdigit():
                            captured_ids.append(v.strip())
        except Exception:
            pass

        await browser.close()

    return captured_ids[0] if captured_ids else None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main():
    print("=" * 50)
    print(f"Find Maxi Store ID — {POSTAL_DISPLAY} (Fleur-de-Lys)")
    print("=" * 50)

    print("\n[1] Trying HTTP approach …")
    store_id = await find_via_http()

    if not store_id:
        print("\n[2] HTTP failed — trying Playwright …")
        store_id = await find_via_playwright()

    print("\n" + "=" * 50)
    if store_id:
        print(f"✅  STORE ID FOUND: {store_id}")
        print(f"\nUpdate backend/.env:")
        print(f"  MAXI_STORE_ID={store_id}")
        print(f"\nThen update the DB store record:")
        print(f"  cd backend")
        print(f"  uv run python scripts/update_maxi_store_id.py {store_id}")
    else:
        print("❌  Could not find store ID automatically.")
        print("Run in headful mode:")
        print("  Set PLAYWRIGHT_HEADLESS=false in .env, then re-run this script.")
        print("  Or open maxi.ca manually, select Fleur-de-Lys, check DevTools → Network → XHR.")
    print("=" * 50)


if __name__ == "__main__":
    asyncio.run(main())
