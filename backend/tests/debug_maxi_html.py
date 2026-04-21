"""
Les prix Maxi sont dans le HTML rendu (Next.js SSR).
Tester: __NEXT_DATA__, sélecteurs DOM, et structure prix.
"""
import asyncio
import json
import re

STORE_ID = "8676"
QUERY = "poulet"


async def main():
    from playwright.async_api import async_playwright

    print(f"🧪 Debug HTML Maxi — '{QUERY}'\n")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131",
            locale="fr-CA",
        )
        await ctx.route("**/*.{png,jpg,jpeg,gif,webp,woff,woff2,ttf,svg,ico}", lambda r: r.abort())
        page = await ctx.new_page()

        url = f"https://www.maxi.ca/en/search?search-bar={QUERY}&storeId={STORE_ID}"
        print(f"→ Navigation: {url}")
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)

        # Attendre que les produits apparaissent dans le DOM
        print("→ Attente des produits...")
        try:
            await page.wait_for_selector('[data-testid*="product"], [class*="product-name"], [class*="ProductName"], h3', timeout=8000)
        except Exception:
            print("  (timeout attente produits)")

        # 1. Extraire __NEXT_DATA__
        print("\n── __NEXT_DATA__ ──")
        next_data_raw = await page.evaluate("() => { const el = document.querySelector('#__NEXT_DATA__'); return el ? el.textContent : null; }")
        if next_data_raw:
            try:
                nd = json.loads(next_data_raw)
                # Explorer les paths habituels
                paths = [
                    ["props", "pageProps", "searchData", "results"],
                    ["props", "pageProps", "initialData", "results"],
                    ["props", "pageProps", "products"],
                    ["props", "pageProps", "searchData", "products"],
                ]
                for path in paths:
                    v = nd
                    for key in path:
                        v = v.get(key, {}) if isinstance(v, dict) else {}
                    if isinstance(v, list) and v:
                        print(f"  ✅ Path {' > '.join(path)}: {len(v)} produits")
                        p = v[0]
                        print(f"  Clés: {list(p.keys())[:15]}")
                        # Prix
                        prices = p.get("prices") or {}
                        name = p.get("name") or p.get("title") or "?"
                        price = prices.get("price", {}).get("value") if isinstance(prices.get("price"), dict) else prices.get("price")
                        print(f"  → {name} | {price}$")
                        print(f"  prices struct: {json.dumps(prices, ensure_ascii=False)[:200]}")
                        break
                else:
                    # Afficher les clés de pageProps pour debug
                    pp_keys = list(nd.get("props", {}).get("pageProps", {}).keys())
                    print(f"  pageProps keys: {pp_keys}")
            except Exception as e:
                print(f"  Erreur parse: {e}")
        else:
            print("  Pas de __NEXT_DATA__")

        # 2. Sélecteurs DOM directs
        print("\n── Sélecteurs DOM ──")
        selectors_to_try = [
            '[data-testid="product-card"]',
            '[class*="product-tile"]',
            '[class*="ProductTile"]',
            '[class*="product-card"]',
            '[class*="ProductCard"]',
            '[class*="search-result"]',
            'article[class*="product"]',
            '[data-code]',
            '[data-product-code]',
        ]
        for sel in selectors_to_try:
            count = await page.evaluate(f"() => document.querySelectorAll('{sel}').length")
            if count > 0:
                print(f"  ✅ '{sel}': {count} éléments")
                # Extraire le premier
                text = await page.evaluate(f"""() => {{
                    const el = document.querySelector('{sel}');
                    return el ? el.innerText.substring(0, 200) : null;
                }}""")
                print(f"     Texte: {text!r}")

        # 3. Chercher les prix directement par pattern dans le HTML
        print("\n── Pattern prix dans le DOM ──")
        prices_in_dom = await page.evaluate("""() => {
            const allText = document.body.innerText;
            const prices = allText.match(/\\$\\s*\\d+[.,]\\d{2}/g) || [];
            return prices.slice(0, 20);
        }""")
        print(f"  Prix trouvés dans le DOM: {prices_in_dom[:10]}")

        # 4. Afficher le titre de la page et les h2/h3 visibles
        title = await page.title()
        print(f"\n── Page title: {title} ──")
        headings = await page.evaluate("""() => {
            return Array.from(document.querySelectorAll('h2, h3, [data-testid*="name"]'))
                        .slice(0, 10).map(e => e.innerText.trim()).filter(Boolean);
        }""")
        print(f"  Headings: {headings}")

        # 5. Chercher dans le HTML brut les patterns JSON de produits
        print("\n── Recherche JSON produits dans le HTML ──")
        html_snippet = await page.evaluate("""() => {
            const html = document.documentElement.outerHTML;
            // Chercher des patterns prix
            const match = html.match(/"prices":\\{"price":\\{"value":(\\d+\\.?\\d*),"wasPrice/);
            if (match) return 'Found prices.price.value pattern: ' + match[0];
            const match2 = html.match(/"regularPrice":(\\d+\\.?\\d*)/);
            if (match2) return 'Found regularPrice: ' + match2[0];
            const match3 = html.match(/"price":(\\d+\\.?\\d*)/);
            if (match3) return 'Found price pattern: ' + match3[0];
            return 'No price pattern found in HTML';
        }""")
        print(f"  {html_snippet}")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
