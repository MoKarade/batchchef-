"""Test du scraper Maxi v2 (extraction DOM). Lancer: uv run python tests/test_maxi_v2.py"""
import asyncio
import logging
logging.basicConfig(level=logging.INFO, format="%(message)s")

TEST = ["poulet", "lait", "beurre", "oeufs", "ail", "pâtes", "huile olive", "fromage cheddar"]


async def main():
    from playwright.async_api import async_playwright
    from app.scrapers.maxi import search_maxi

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131",
            locale="fr-CA",
        )
        await ctx.route("**/*.{png,jpg,jpeg,gif,webp,woff,woff2,ttf,svg,ico}", lambda r: r.abort())
        page = await ctx.new_page()

        results = {}
        for q in TEST:
            print(f"\n🔍 {q}")
            r = await search_maxi(page, q)
            results[q] = r

        await browser.close()

    print("\n" + "="*65)
    print("RÉSUMÉ")
    print("="*65)
    ok = sum(1 for v in results.values() if v)
    print(f"Trouvés: {ok}/{len(TEST)}")
    for q, r in results.items():
        if r:
            print(f"  ✅ {q:25} → {r['price']:.2f}$ | {r['format_qty']} {r['format_unit']}")
            print(f"       {r['product_name'][:55]}")
        else:
            print(f"  ❌ {q:25} → pas trouvé")


if __name__ == "__main__":
    asyncio.run(main())
