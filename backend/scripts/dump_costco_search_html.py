"""Dump the full rendered HTML of a Costco search page for offline grep."""
import asyncio
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from patchright.async_api import async_playwright  # noqa: E402
from app.scrapers._utils import try_accept_cookies  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "debug" / "costco"
OUT.mkdir(parents=True, exist_ok=True)


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            channel="chrome", headless=False,
            args=["--disable-blink-features=AutomationControlled"],
        )
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            locale="fr-CA",
        )
        page = await ctx.new_page()
        await page.goto("https://www.costco.ca/", wait_until="domcontentloaded", timeout=40000)
        await page.wait_for_timeout(4000)
        await try_accept_cookies(page)
        await page.evaluate("document.querySelector('#onetrust-consent-sdk')?.remove();")

        term = "eggs"
        url = f"https://www.costco.ca/s?dept=All&keyword={term}"
        await page.goto(url, wait_until="domcontentloaded", timeout=40000)
        await page.wait_for_timeout(8000)  # let lazy loads happen
        # scroll through to trigger any infinite scroll
        for i in range(5):
            await page.evaluate("window.scrollBy(0, 1200)")
            await page.wait_for_timeout(1500)

        html = await page.content()
        f_html = OUT / f"search_{term}_{int(time.time())}.html"
        f_html.write_text(html, encoding="utf-8")
        print(f"saved: {f_html}  ({len(html)} chars)")

        # regex probes — multiple patterns Costco has used historically
        patterns = {
            "itemNumber quoted": r'"itemNumber"\s*:\s*"?(\d{6,13})"?',
            "itemId quoted":     r'"itemId"\s*:\s*"?(\d{6,13})"?',
            "/product-name.product.XXX.html":  r'\.product\.(\d{6,13})',
            "data-sku":          r'data-sku="(\d{6,13})"',
            "data-product-id":   r'data-product-id="(\d{6,13})"',
            "productNumber":     r'productNumber["\s:=]+(\d{6,13})',
            "data-itemid":       r'data-itemid="(\d{6,13})"',
        }
        print()
        all_found = set()
        for name, pat in patterns.items():
            found = set(re.findall(pat, html))
            if found:
                print(f"  {name:35s} {len(found)} matches → sample: {list(found)[:3]}")
                all_found |= found
        print(f"\nTOTAL unique item-like ids: {len(all_found)}")

        # Also: find any <a href> that points at /product
        hrefs = set(re.findall(r'href="([^"]*\.product\.[^"]*)"', html))
        print(f"Product page hrefs found: {len(hrefs)}")
        for h in list(hrefs)[:5]:
            print(f"  {h}")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
