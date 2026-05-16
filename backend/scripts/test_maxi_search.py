"""
Validate Maxi scraper against storeId 7234 (Fleur-de-Lys, Québec).
Searches for 5 test ingredients and prints results.

Usage: cd backend && uv run python scripts/test_maxi_search.py
"""
import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TEST_QUERIES = ["lait", "beurre", "oeufs", "farine", "poulet"]
STORE_ID = "7234"


async def main():
    from playwright.async_api import async_playwright
    from app.scrapers.maxi import search_maxi
    from app.scrapers._utils import try_accept_cookies

    print(f"Testing Maxi storeId={STORE_ID} (Fleur-de-Lys, Québec)")
    print("=" * 50)

    ok = 0
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
        await context.route(
            "**/*.{png,jpg,jpeg,gif,webp,woff,woff2,ttf,otf,css,svg}",
            lambda r: r.abort(),
        )
        page = await context.new_page()

        # Accept cookies once
        await page.goto("https://www.maxi.ca", wait_until="domcontentloaded", timeout=20000)
        await try_accept_cookies(page)

        for q in TEST_QUERIES:
            result = await search_maxi(page, q, store_id=STORE_ID)
            if result:
                ok += 1
                print(
                    f"  OK  {q:12s} -> {result['product_name'][:40]:40s} | "
                    f"{result['price']:.2f}$ "
                    f"({result['format_qty'] or '?'}{result['format_unit'] or '?'})"
                )
            else:
                print(f"  --  {q:12s} -> no result")

        await browser.close()

    print("=" * 50)
    print(f"Results: {ok}/{len(TEST_QUERIES)} found")
    if ok == 0:
        print("ERROR: no results — check MAXI_STORE_ID or network")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
