"""
Test final: attendre networkidle + capturer l'endpoint XHR de recherche.
"""
import asyncio
import json
import re

STORE_ID = "8676"
QUERY = "poulet"


async def main():
    from playwright.async_api import async_playwright

    print(f"🔍 Test final Maxi — '{QUERY}'\n")
    search_xhr = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131",
            locale="fr-CA",
        )
        await ctx.route("**/*.{png,jpg,jpeg,gif,webp,woff,woff2,ttf,svg,ico}", lambda r: r.abort())
        page = await ctx.new_page()

        async def on_response(resp):
            url = resp.url
            ct = resp.headers.get("content-type", "")
            if "json" in ct and any(k in url for k in ["pcexpress", "pcxcdn", "maxi.ca"]):
                try:
                    body = await resp.json()
                    # Chercher récursivement des produits avec prix
                    def has_products(obj, depth=0):
                        if depth > 4: return False
                        if isinstance(obj, list) and obj and isinstance(obj[0], dict):
                            if obj[0].get("name") or obj[0].get("code"):
                                return True
                        if isinstance(obj, dict):
                            return any(has_products(v, depth+1) for v in obj.values())
                        return False
                    if has_products(body):
                        search_xhr.append({"url": url, "body": body})
                except Exception:
                    pass

        page.on("response", on_response)

        url = f"https://www.maxi.ca/en/search?search-bar={QUERY}&storeId={STORE_ID}"
        print(f"→ Chargement (networkidle)...")
        try:
            await page.goto(url, wait_until="networkidle", timeout=30000)
        except Exception:
            pass  # networkidle timeout OK
        await page.wait_for_timeout(2000)
        page.remove_listener("response", on_response)

        # Afficher les XHR capturés
        print(f"\n📡 XHRs avec produits: {len(search_xhr)}")
        for item in search_xhr:
            print(f"\n  URL: {item['url']}")
            body = item['body']
            def find_prods(obj, depth=0):
                if depth > 4: return None
                if isinstance(obj, list) and obj and isinstance(obj[0], dict) and (obj[0].get("name") or obj[0].get("code")):
                    return obj
                if isinstance(obj, dict):
                    for v in obj.values():
                        r = find_prods(v, depth+1)
                        if r: return r
                return None
            prods = find_prods(body)
            if prods:
                p = prods[0]
                prices = p.get("prices") or {}
                price = prices.get("price", {}).get("value") if isinstance(prices.get("price"), dict) else None
                print(f"  ✅ {len(prods)} produits | {p.get('name')} → {price}$")
                print(f"  prices: {json.dumps(prices)[:150]}")

        # Extraire les produits du DOM (après networkidle)
        print("\n── Extraction DOM (après networkidle) ──")
        dom_data = await page.evaluate("""() => {
            // Chercher tous les éléments h3 avec un prix à proximité
            const results = [];
            const h3s = Array.from(document.querySelectorAll('h3'));
            
            for (const h3 of h3s.slice(0, 20)) {
                const name = h3.innerText.trim();
                if (!name || name.length < 5) continue;
                
                // Chercher le prix dans les siblings/parent
                let priceEl = null;
                let el = h3;
                for (let i = 0; i < 5; i++) {
                    el = el.parentElement;
                    if (!el) break;
                    priceEl = el.querySelector('[class*="price"], [data-testid*="price"]');
                    if (priceEl) break;
                }
                
                const priceText = priceEl ? priceEl.innerText.trim() : '';
                const priceMatch = priceText.match(/\$?(\d+[.,]\d{2})/);
                const price = priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : null;
                
                results.push({ name, price, priceText });
            }
            return results;
        }""")
        
        print(f"  Produits extraits: {len(dom_data)}")
        for p in dom_data[:10]:
            if p.get("name") and len(p["name"]) > 5:
                print(f"  • {p['name'][:60]} → {p['price']}$ ({p['priceText'][:30]})")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
