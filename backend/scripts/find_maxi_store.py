"""
One-shot helper: discover the Maxi storeId for Fleur-de-Lys (550 Rue Fleur-de-Lys,
Québec, G1M 3E5) by navigating maxi.ca, entering the postal code in the store
selector, and intercepting the resulting network responses.

Usage:
    cd backend && uv run python scripts/find_maxi_store.py

Prints the storeId to paste into `backend/.env::MAXI_STORE_ID`.
"""
import asyncio
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from patchright.async_api import async_playwright  # noqa: E402

POSTAL = "G1M 3E5"
STREET_HINT = "fleur-de-lys"


async def main():
    captured: list[dict] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=False, channel="chrome")
        context = await browser.new_context(locale="fr-CA")
        page = await context.new_page()

        async def on_response(resp):
            url = resp.url
            if "store" not in url.lower() and "pickup" not in url.lower():
                return
            try:
                if "application/json" not in (resp.headers.get("content-type") or ""):
                    return
                body = await resp.json()
            except Exception:
                return
            captured.append({"url": url, "body": body})

        page.on("response", lambda r: asyncio.create_task(on_response(r)))

        print("-> Loading maxi.ca...")
        await page.goto("https://www.maxi.ca/", wait_until="domcontentloaded", timeout=45000)
        await page.wait_for_timeout(3500)

        # Dismiss cookie banner
        for text in ("Accept", "J'accepte", "Accepter"):
            try:
                btn = page.get_by_role("button", name=re.compile(text, re.I))
                if await btn.count():
                    await btn.first.click(timeout=2000)
                    break
            except Exception:
                pass

        # Click store picker (usually shows current store in header)
        print("-> Opening store picker...")
        clicked = await page.evaluate(
            r"""() => {
                const el = Array.from(document.querySelectorAll('button, a')).find(e => {
                    const t = (e.innerText||'').toLowerCase();
                    return /change store|changer de magasin|choose store|sélectionner un magasin|find a store|trouver un magasin|my store|mon magasin/.test(t);
                });
                if (el) { el.click(); return (el.innerText||'').trim().slice(0,120); }
                return null;
            }"""
        )
        print(f"  clicked: {clicked!r}")
        await page.wait_for_timeout(2500)

        # Fill postal code
        try:
            sel = 'input[type="search"], input[placeholder*="ostal" i], input[aria-label*="ostal" i], input[name*="search" i]'
            await page.wait_for_selector(sel, timeout=8000)
            box = page.locator(sel).first
            await box.click()
            await box.fill("")
            await box.type(POSTAL, delay=80)
            await page.keyboard.press("Enter")
        except Exception as e:
            print(f"  ! could not fill search: {e}")

        await page.wait_for_timeout(5000)

        # Try to click the Fleur-de-Lys result
        picked = await page.evaluate(
            r"""(hint) => {
              const all = Array.from(document.querySelectorAll('li, button, a, div, [role="option"]'));
              const hit = all.find(e => (e.innerText||'').toLowerCase().includes(hint) && e.offsetParent !== null);
              if (!hit) return null;
              hit.scrollIntoView();
              hit.click();
              return (hit.innerText||'').trim().slice(0,200);
            }""",
            STREET_HINT,
        )
        print(f"-> Picked: {picked!r}")
        await page.wait_for_timeout(4000)

        # Scan captured responses for storeId
        print("\n-> Scanning intercepted responses for store id...")
        for entry in captured:
            txt = json.dumps(entry["body"])[:1500]
            if "fleur" in txt.lower() or STREET_HINT in txt.lower():
                print(f"\nURL: {entry['url']}")
                print(f"BODY (truncated): {txt}")

        # Also: the final cookie often has it
        cookies = {c["name"]: c["value"] for c in await context.cookies()}
        print("\nRelevant cookies:")
        for k, v in cookies.items():
            if "store" in k.lower() or "magasin" in k.lower():
                print(f"  {k} = {v}")

        await page.wait_for_timeout(3000)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
