"""Look for itemNumbers in the server-rendered search HTML."""
import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from patchright.async_api import async_playwright  # noqa: E402
from app.scrapers._utils import try_accept_cookies  # noqa: E402


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            channel="chrome", headless=False,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
            ),
            locale="fr-CA",
        )
        page = await context.new_page()
        await page.goto("https://www.costco.ca/", wait_until="domcontentloaded", timeout=40000)
        await page.wait_for_timeout(5000)
        await try_accept_cookies(page)
        await page.evaluate("document.querySelector('#onetrust-consent-sdk')?.remove();")

        for term in ["eggs", "butter", "olive oil"]:
            await page.goto(f"https://www.costco.ca/s?dept=All&keyword={term}",
                            wait_until="domcontentloaded", timeout=40000)
            await page.wait_for_timeout(6000)
            html = await page.content()

            # Look for itemNumbers in the HTML (must be same format as GraphQL)
            item_nums = set(re.findall(r'"itemNumber"\s*:\s*"(\d+)"', html))
            item_nums |= set(re.findall(r'item(?:Number|Id)=(\d{6,12})', html))
            item_nums |= set(re.findall(r'/\.product\.(\d+)\.html', html))
            # Costco URLs look like: /product-name.product.100000123.html
            url_ids = set(re.findall(r'\.product\.(\d+)', html))
            # And data-sku or data-productid
            data_ids = set(re.findall(r'data-(?:sku|productid|itemnumber)="(\d+)"', html))

            all_ids = item_nums | url_ids | data_ids
            print(f"\n'{term}': itemNumbers={len(item_nums)}  url_ids={len(url_ids)}  data_ids={len(data_ids)}  total_unique={len(all_ids)}")
            for n in list(all_ids)[:10]:
                print(f"  {n}")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
