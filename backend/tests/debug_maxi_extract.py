"""
Extraction finale: products depuis initialSearchData + prix depuis DOM.
"""
import asyncio
import json
import re

STORE_ID = "8676"
QUERY = "poulet"


def is_relevant(query: str, product_name: str) -> bool:
    import unicodedata
    def norm(s):
        s = unicodedata.normalize("NFD", s.lower())
        s = "".join(c for c in s if unicodedata.category(c) != "Mn")
        return re.sub(r"[^a-z0-9\s]", "", s)
    q_words = [w for w in norm(query).split() if len(w) >= 2]
    p = norm(product_name)
    if not q_words:
        return norm(query) in p
    matches = sum(1 for w in q_words if re.search(rf"\b{re.escape(w)}\b", p))
    return (matches / len(q_words)) >= 0.6


def parse_format(name: str) -> dict:
    m = re.search(r"(\d+)\s*x\s*(\d+[\.,]?\d*)\s*(g|kg|ml|l|lb|oz)\b", name, re.I)
    if m:
        total = float(m.group(1)) * float(m.group(2).replace(",", "."))
        return {"qty": round(total, 2), "unit": m.group(3).lower()}
    m = re.search(r"(\d+[\.,]?\d*)\s*(g|kg|ml|l|lb|oz)\b", name, re.I)
    if m:
        return {"qty": float(m.group(1).replace(",", ".")), "unit": m.group(2).lower()}
    return {"qty": 1, "unit": "unite"}


async def main():
    from playwright.async_api import async_playwright

    print(f"🔍 Extraction Maxi — '{QUERY}'\n")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131",
            locale="fr-CA",
        )
        await ctx.route("**/*.{png,jpg,jpeg,gif,webp,woff,woff2,ttf,svg,ico}", lambda r: r.abort())
        page = await ctx.new_page()

        url = f"https://www.maxi.ca/en/search?search-bar={QUERY}&storeId={STORE_ID}"
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)

        # ── Stratégie 1: __NEXT_DATA__ > initialSearchData ──────────────────
        print("── Stratégie 1: __NEXT_DATA__ initialSearchData ──")
        result = await page.evaluate("""() => {
            try {
                const el = document.querySelector('#__NEXT_DATA__');
                if (!el) return null;
                const d = JSON.parse(el.textContent);
                const isd = d?.props?.pageProps?.initialSearchData;
                if (!isd) return { error: 'No initialSearchData', keys: Object.keys(d?.props?.pageProps || {}) };
                // initialSearchData contient probablement une structure results
                return {
                    type: typeof isd,
                    isArray: Array.isArray(isd),
                    keys: typeof isd === 'object' && !Array.isArray(isd) ? Object.keys(isd) : null,
                    len: Array.isArray(isd) ? isd.length : null,
                    sample: JSON.stringify(isd).substring(0, 500),
                };
            } catch(e) { return { error: e.message }; }
        }""")
        print(f"  initialSearchData: {json.dumps(result, ensure_ascii=False, indent=2)[:600]}")

        # ── Stratégie 2: Produits depuis le DOM avec data-attributes ──────────
        print("\n── Stratégie 2: data-attributes sur les produits ──")
        dom_products = await page.evaluate("""() => {
            // Chercher tous les éléments avec des attributs de données produit
            const attrs = ['data-code', 'data-product-code', 'data-product-id', 'data-testid', 'data-id'];
            for (const attr of attrs) {
                const els = document.querySelectorAll(`[${attr}]`);
                if (els.length > 2) {
                    return {
                        attr,
                        count: els.length,
                        sample: Array.from(els).slice(0, 3).map(e => ({
                            attr_val: e.getAttribute(attr),
                            text: e.innerText.substring(0, 100)
                        }))
                    };
                }
            }
            return null;
        }""")
        print(f"  data-attributes: {json.dumps(dom_products, ensure_ascii=False)[:400]}")

        # ── Stratégie 3: Parser les cartes produit dans le HTML ──────────────
        print("\n── Stratégie 3: Parser cartes produit ──")
        cards = await page.evaluate("""() => {
            // Trouver le conteneur des résultats de recherche
            const containers = [
                '[class*="search-results"]',
                '[class*="SearchResults"]', 
                '[class*="product-grid"]',
                '[class*="ProductGrid"]',
                'main [class*="grid"]',
                'ul[class*="product"]',
            ];
            
            let container = null;
            for (const sel of containers) {
                container = document.querySelector(sel);
                if (container) break;
            }
            
            if (!container) {
                // Fallback: chercher des éléments avec des prix
                const allEls = Array.from(document.querySelectorAll('*'));
                const withPrice = allEls.filter(el => {
                    const t = el.innerText || '';
                    return t.match(/\\$\\d+\\.\\d{2}/) && el.children.length < 5 && t.length < 300;
                });
                return { fallback: true, count: withPrice.length, samples: withPrice.slice(0, 3).map(e => e.innerText.trim().substring(0, 150)) };
            }
            
            return { containerClass: container.className.substring(0, 50), childCount: container.children.length };
        }""")
        print(f"  Cards container: {json.dumps(cards, ensure_ascii=False)[:400]}")

        # ── Stratégie 4: Extract depuis le HTML complet avec regex ──────────
        print("\n── Stratégie 4: JSON produits via regex dans le HTML ──")
        products_from_html = await page.evaluate("""() => {
            const html = document.documentElement.outerHTML;
            
            // Pattern typique des produits Loblaw/PCX dans le HTML:
            // {"code":"xxx","name":"Chicken Breast","brand":"...","prices":{"price":{"value":X.XX},...}}
            const pattern = /"code":"([^"]+)","name":"([^"]+)"[^}]*?"prices":\\{"price":\\{"value":([\\d.]+)/g;
            const results = [];
            let m;
            while ((m = pattern.exec(html)) !== null && results.length < 10) {
                results.push({ code: m[1], name: m[2], price: parseFloat(m[3]) });
            }
            return results;
        }""")
        print(f"  Produits regex: {json.dumps(products_from_html, ensure_ascii=False)}")

        # ── Stratégie 5: Trouver le bon noeud JSON dans __NEXT_DATA__ ────────
        print("\n── Stratégie 5: Explorer __NEXT_DATA__ en profondeur ──")
        deep_result = await page.evaluate("""() => {
            try {
                const d = JSON.parse(document.querySelector('#__NEXT_DATA__').textContent);
                const isd = d?.props?.pageProps?.initialSearchData;
                
                // Chercher récursivement des tableaux d'objets avec 'name' et 'prices'
                function findProducts(obj, depth=0) {
                    if (depth > 5 || !obj) return null;
                    if (Array.isArray(obj) && obj.length > 0 && obj[0]?.name && obj[0]?.prices) {
                        return obj;
                    }
                    if (typeof obj === 'object') {
                        for (const key of Object.keys(obj)) {
                            const found = findProducts(obj[key], depth + 1);
                            if (found) return found;
                        }
                    }
                    return null;
                }
                
                const products = findProducts(isd);
                if (products) {
                    return {
                        count: products.length,
                        first: {
                            name: products[0].name,
                            code: products[0].code,
                            prices: products[0].prices,
                            brand: products[0].brand,
                        }
                    };
                }
                return { error: 'No products found', isdType: typeof isd, isdKeys: typeof isd === 'object' ? Object.keys(isd).slice(0, 10) : null };
            } catch(e) { return { error: e.message }; }
        }""")
        print(f"  Deep search: {json.dumps(deep_result, ensure_ascii=False, indent=2)}")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
