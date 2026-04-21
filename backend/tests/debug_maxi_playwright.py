"""
Debug Playwright ciblé: intercepte api.pcexpress.ca/pcx-bff (la nouvelle API Loblaw).
Affiche la structure exacte des réponses produits.
"""
import asyncio
import json

STORE_ID = "8676"
QUERY = "poulet"


async def main():
    from playwright.async_api import async_playwright

    print(f"🧪 Debug Playwright Maxi — store #{STORE_ID} | '{QUERY}'\n")

    all_pcx = []  # Toutes les réponses pcexpress.ca/pcx-bff

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131",
            locale="fr-CA",
        )
        # Bloquer seulement les vraies ressources lourdes, laisser passer le JS/XHR
        await ctx.route("**/*.{png,jpg,jpeg,gif,webp,woff,woff2,ttf,svg,ico,css}", lambda r: r.abort())

        page = await ctx.new_page()

        async def on_response(resp):
            url = resp.url
            # Capturer TOUTES les réponses PCX BFF
            if "pcexpress.ca/pcx-bff" in url or "iceberg-bff" in url:
                try:
                    ct = resp.headers.get("content-type", "")
                    if "json" in ct:
                        body = await resp.json()
                        all_pcx.append({"url": url, "body": body})
                except Exception:
                    pass

        page.on("response", on_response)

        url = f"https://www.maxi.ca/en/search?search-bar={QUERY}&storeId={STORE_ID}"
        print(f"→ Chargement: {url}")
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        except Exception as e:
            print(f"  Timeout (ok): {e}")

        # Attendre 5s que les XHR de recherche se lancent
        await page.wait_for_timeout(5000)
        page.remove_listener("response", on_response)

        print(f"\n📦 Réponses PCX BFF capturées: {len(all_pcx)}")
        for item in all_pcx:
            url = item["url"]
            body = item["body"]
            print(f"\n  📡 {url}")

            # Chercher les produits à tous les niveaux possibles
            products = None
            if isinstance(body, list):
                products = body
            elif isinstance(body, dict):
                for path in ["results", "products", "items", "data"]:
                    v = body.get(path)
                    if isinstance(v, list) and v:
                        products = v
                        break
                    elif isinstance(v, dict):
                        for sub in ["products", "results", "items"]:
                            vv = v.get(sub)
                            if isinstance(vv, list) and vv:
                                products = vv
                                break

            if products:
                p = products[0]
                print(f"  ✅ {len(products)} produit(s)")
                print(f"  Clés: {list(p.keys())}")
                # Chercher prix
                price_val = None
                for key in ["prices", "price", "currentPrice", "regularPrice"]:
                    v = p.get(key)
                    if isinstance(v, dict):
                        price_val = v.get("value") or v.get("price", {}).get("value") if isinstance(v.get("price"), dict) else None
                    elif isinstance(v, (int, float)):
                        price_val = v
                    if price_val:
                        break
                name = p.get("name") or p.get("title") or p.get("displayName") or "?"
                print(f"  → {name} | prix={price_val}")
                if "prices" in p:
                    print(f"  prices struct: {json.dumps(p['prices'], ensure_ascii=False)[:300]}")
            else:
                print(f"  Structure: {json.dumps(body, ensure_ascii=False)[:200]}")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
