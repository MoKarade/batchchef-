import asyncio
import sys
sys.path.insert(0, ".")
from app.scrapers.maxi import is_relevant

QUERY = "poulet"

async def test():
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 Chrome/131", locale="fr-CA"
        )
        await ctx.route("**/*.{png,jpg,gif,webp,woff,woff2,ico}", lambda r: r.abort())
        page = await ctx.new_page()

        # Test French URL
        url = f"https://www.maxi.ca/fr/recherche?recherche={QUERY}&magasinId=8676"
        print(f"URL: {url}")
        try:
            await page.goto(url, wait_until="networkidle", timeout=30000)
        except Exception:
            pass

        h3s = await page.evaluate(
            "() => Array.from(document.querySelectorAll('h3')).slice(0,25).map(e=>e.innerText.trim()).filter(Boolean)"
        )
        print(f"\n── h3s ({len(h3s)} trouvés) ──")
        for name in h3s[:15]:
            rel = is_relevant(QUERY, name)
            print(f"  {'✅' if rel else '❌'} {name!r}")

        # Also check prices found
        prices = await page.evaluate(
            r"() => Array.from(document.querySelectorAll('[class*=price],[data-testid*=price]')).slice(0,10).map(e=>e.innerText.trim())"
        )
        print(f"\n── Prix ({len(prices)}) ──")
        for p in prices[:8]:
            print(f"  {p!r}")

        await browser.close()

asyncio.run(test())
