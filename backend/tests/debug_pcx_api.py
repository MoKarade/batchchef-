"""
Test direct de l'API PCX BFF (Loblaw/Maxi) sans Playwright.
Identifie la structure exacte des réponses prix.
"""
import asyncio
import json
import httpx

STORE_ID = "8676"        # Maxi Fleur-de-Lys
BANNER = "maxi"
QUERY = "poulet"

HEADERS_BASE = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "fr-CA,fr;q=0.9,en;q=0.8",
    "Origin": "https://www.maxi.ca",
    "Referer": "https://www.maxi.ca/",
}

# Endpoints à tester (identifiés dans debug réseau)
ENDPOINTS = [
    {
        "label": "PCX BFF search",
        "method": "GET",
        "url": f"https://api.pcexpress.ca/pcx-bff/api/v1/products/search?lang=fr&date=&storeId={STORE_ID}&banner={BANNER}&pageSize=5&cursor=&sortOrder=RELEVANCE&query={QUERY}",
    },
    {
        "label": "PCX BFF search v2",
        "method": "GET",
        "url": f"https://api.pcexpress.ca/pcx-bff/api/v2/products/search?lang=fr&storeId={STORE_ID}&banner={BANNER}&pageSize=5&sortOrder=RELEVANCE&query={QUERY}",
    },
    {
        "label": "PCX BFF type-ahead",
        "method": "GET",
        "url": f"https://api.pcexpress.ca/pcx-bff/api/v1/products/type-ahead?lang=fr&storeId={STORE_ID}&banner={BANNER}&query={QUERY}",
    },
    {
        "label": "Loblaw BFF search (gql)",
        "method": "GET",
        "url": f"https://api.pcexpress.ca/product-facade/v4/products?lang=fr&date=&storeId={STORE_ID}&pageSize=5&search={QUERY}&sortBy=RELEVANCE&banner={BANNER}",
    },
    {
        "label": "Maxi direct search API",
        "method": "GET",
        "url": f"https://www.maxi.ca/api/products/ca/en/{STORE_ID}/search?query={QUERY}&sortBy=relevance&pageSize=3",
    },
]


async def test_endpoint(client: httpx.AsyncClient, ep: dict) -> None:
    print(f"\n{'='*60}")
    print(f"🔍 {ep['label']}")
    print(f"   {ep['url'][:100]}")
    try:
        r = await client.get(ep["url"], headers=HEADERS_BASE, timeout=15.0)
        print(f"   Status: {r.status_code}")
        ct = r.headers.get("content-type", "")
        print(f"   Content-Type: {ct}")

        if r.status_code == 200 and "json" in ct:
            body = r.json()
            # Chercher les produits à différents niveaux
            candidates = [
                body.get("results"),
                body.get("products"),
                (body.get("data") or {}).get("products"),
                body.get("items"),
            ]
            for products in candidates:
                if isinstance(products, list) and products:
                    p = products[0]
                    print(f"   ✅ Produits trouvés: {len(products)}")
                    # Chercher le prix
                    price = (
                        (p.get("prices") or {}).get("price", {}).get("value") or
                        (p.get("price") or {}).get("value") if isinstance(p.get("price"), dict) else None or
                        p.get("currentPrice") or
                        p.get("regularPrice")
                    )
                    name = p.get("name") or p.get("title") or p.get("displayName") or "?"
                    print(f"   Premier produit: {name} → {price}$")
                    print(f"   Clés disponibles: {list(p.keys())[:15]}")
                    # Afficher la structure prix
                    if "prices" in p:
                        print(f"   Structure prices: {json.dumps(p['prices'], ensure_ascii=False)[:200]}")
                    return

            # Aucun tableau trouvé
            print(f"   Structure top-level: {list(body.keys())}")
            print(f"   Extrait: {json.dumps(body, ensure_ascii=False)[:300]}")
        else:
            print(f"   Body: {r.text[:200]}")

    except Exception as e:
        print(f"   ❌ Erreur: {e}")


async def main():
    print(f"🧪 Test API Loblaw/Maxi — store #{STORE_ID} | query='{QUERY}'")

    async with httpx.AsyncClient(follow_redirects=True) as client:
        for ep in ENDPOINTS:
            await test_endpoint(client, ep)

    print("\n" + "="*60)
    print("💡 Si tous échouent → utiliser Playwright avec interception")


if __name__ == "__main__":
    asyncio.run(main())
