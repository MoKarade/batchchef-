"""
Debug: Capture tous les appels réseau sur maxi.ca/search pour un ingrédient.
Identifie le bon endpoint API à intercepter.
"""
import asyncio
import json
import re

STORE_ID = "8676"
QUERY = "poulet"


async def main():
    from playwright.async_api import async_playwright

    print(f"🔍 Debug réseau pour: '{QUERY}'\n")
    api_candidates = []
    all_json_urls = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131"
        )

        # Bloquer seulement les médias lourds, garder tout le reste
        await ctx.route("**/*.{png,jpg,jpeg,gif,webp,woff,woff2,ttf,svg,ico}", lambda r: r.abort())

        page = await ctx.new_page()

        # Capturer TOUTES les réponses JSON
        async def on_response(response):
            url = response.url
            ct = response.headers.get("content-type", "")
            if "json" in ct:
                all_json_urls.append(url)
                # Chercher les endpoints qui semblent liés aux produits
                if any(k in url.lower() for k in ["product", "search", "catalog", "item", "price", "loblaw", "pcx", "maxi"]):
                    try:
                        body = await response.json()
                        api_candidates.append({"url": url, "body": body})
                        print(f"  📡 JSON API: {url}")
                    except Exception:
                        pass

        page.on("response", on_response)

        url = f"https://www.maxi.ca/en/search?search-bar={QUERY}&storeId={STORE_ID}"
        print(f"Navigation vers: {url}")
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(4000)  # Attendre que le JS charge
        except Exception as e:
            print(f"  Timeout/error (normal): {e}")

        page.remove_listener("response", on_response)

        # Essayer aussi de récupérer __NEXT_DATA__
        next_data = await page.evaluate("""() => {
            const el = document.querySelector('#__NEXT_DATA__');
            return el ? el.textContent.substring(0, 500) : null;
        }""")
        if next_data:
            print(f"\n  📄 __NEXT_DATA__ (extrait): {next_data[:200]}")

        # Titre de la page
        title = await page.title()
        print(f"  📃 Titre page: {title}")

        # Récupérer le texte des produits visibles
        products_text = await page.evaluate("""() => {
            const sels = ['[class*="product-name"]','[class*="ProductName"]','h2','h3',
                          '[data-testid*="product"]','[aria-label*="product"]'];
            for (const s of sels) {
                const els = Array.from(document.querySelectorAll(s)).slice(0, 3);
                if (els.length) return els.map(e => e.innerText.trim()).filter(Boolean);
            }
            return [];
        }""")
        if products_text:
            print(f"  🏪 Produits visibles: {products_text}")

        # Essayer l'API directe depuis la page
        print("\n  🧪 Test API directe Loblaw...")
        for api_template in [
            f"https://www.maxi.ca/api/products/ca/en/{STORE_ID}/search?query={QUERY}&sortBy=relevance&pageSize=3",
            f"https://api.pcxcdn.com/product-facade/v4/products?lang=en&date=&storeId={STORE_ID}&pageSize=5&search={QUERY}",
        ]:
            result = await page.evaluate(f"""async () => {{
                try {{
                    const r = await fetch({json.dumps(api_template)}, {{
                        headers: {{
                            'Accept': 'application/json',
                            'x-apikey': 'l7xx1f8i8j9h2e5d4b3c6a',
                        }}
                    }});
                    const status = r.status;
                    const ct = r.headers.get('content-type') || '';
                    const text = ct.includes('json') ? JSON.stringify(await r.json()) : await r.text();
                    return {{ status, text: text.substring(0, 300) }};
                }} catch(e) {{
                    return {{ error: e.message }};
                }}
            }}""")
            print(f"  URL: {api_template[:80]}...")
            print(f"  Réponse: {result}")

        await browser.close()

    print(f"\n📊 Total JSON APIs interceptées: {len(all_json_urls)}")
    for u in all_json_urls[:20]:
        print(f"  - {u}")

    print(f"\n📦 Candidats produits: {len(api_candidates)}")
    for c in api_candidates[:3]:
        print(f"\n  URL: {c['url']}")
        body = c['body']
        # Chercher les résultats dans la structure
        results = body.get("results") or body.get("products") or body.get("data", {}).get("products") or []
        if results:
            p = results[0]
            print(f"  Premier produit: {json.dumps(p, ensure_ascii=False)[:300]}")
        else:
            print(f"  Structure: {json.dumps(body, ensure_ascii=False)[:300]}")


if __name__ == "__main__":
    asyncio.run(main())
