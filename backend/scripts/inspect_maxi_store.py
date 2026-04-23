"""Inspect Maxi store selector — click MON MAGASIN then dump what opens."""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from patchright.async_api import async_playwright  # noqa: E402


async def main():
    captured: list[dict] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=False, channel="chrome")
        context = await browser.new_context(locale="fr-CA")
        page = await context.new_page()

        async def on_response(resp):
            url = resp.url
            ct = (resp.headers.get("content-type") or "")
            if "json" not in ct:
                return
            if not any(k in url.lower() for k in ("store", "magasin", "location", "pickup")):
                return
            try:
                body = await resp.json()
            except Exception:
                return
            captured.append({"url": url, "body": body})

        page.on("response", lambda r: asyncio.create_task(on_response(r)))

        await page.goto("https://www.maxi.ca/", wait_until="domcontentloaded", timeout=45000)
        await page.wait_for_timeout(4000)

        # Dump cookies
        cookies = {c["name"]: c["value"] for c in await context.cookies()}
        print("Initial relevant cookies:")
        for k, v in cookies.items():
            if any(x in k.lower() for x in ("store", "magasin", "whs")):
                print(f"  {k} = {v}")

        # Click the fulfillment trigger (the correct button for store/postal picker)
        print("\n--- Clicking [iceberg-fulfillment-trigger] ---")
        await page.click('[data-testid="iceberg-fulfillment-trigger"]')
        await page.wait_for_timeout(4000)

        # Now type the target postal
        for sel in (
            'input[type="search"]',
            'input[placeholder*="ostal" i]',
            'input[aria-label*="ostal" i]',
            'input[placeholder*="Code" i]',
        ):
            try:
                await page.wait_for_selector(sel, timeout=2000)
                print(f"    input found via: {sel}")
                await page.locator(sel).first.click()
                await page.keyboard.type("G1M 3E5", delay=120)
                await page.wait_for_timeout(2500)
                break
            except Exception:
                continue

        # Dump what's open now — look for any dialog/modal/drawer
        print("\n=== DIALOGS / MODALS ===")
        html = await page.evaluate(
            r"""() => {
              const sels = ['[role="dialog"]', '[aria-modal="true"]', '[class*="odal"]', '[class*="rawer"]', 'nav[class*="store" i]'];
              const found = new Set();
              for (const s of sels) document.querySelectorAll(s).forEach(e => found.add(e));
              return Array.from(found).filter(e => e.offsetParent !== null).map(e => e.outerHTML.slice(0,3000)).join('\n---\n');
            }"""
        )
        print((html or "(none)")[:6000])

        print("\n=== VISIBLE INPUTS ===")
        inputs = await page.evaluate(
            r"""() => Array.from(document.querySelectorAll('input')).filter(i => i.offsetParent !== null).map(i => ({
              type: i.type, name: i.name, placeholder: i.placeholder, id: i.id, aria: i.getAttribute('aria-label')
            }))"""
        )
        for i in inputs:
            print(f"  {i}")

        print("\n=== VISIBLE BUTTONS ===")
        btns = await page.evaluate(
            r"""() => Array.from(document.querySelectorAll('button, a[role="button"]')).filter(b => b.offsetParent !== null).slice(0, 40).map(b => ({
              text: (b.innerText||'').trim().slice(0,80), testid: b.getAttribute('data-testid'), href: b.getAttribute('href')
            })).filter(b => b.text)"""
        )
        for b in btns:
            print(f"  [{b.get('testid')}] {b['text']}")

        print("\n=== INTERCEPTED STORE RESPONSES ===")
        for entry in captured[-10:]:
            print(f"  {entry['url']}")
            txt = json.dumps(entry["body"])[:300]
            print(f"    {txt}")

        await page.wait_for_timeout(1500)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
