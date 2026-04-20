"""
Test du scraper Maxi — 3 stratégies (interception API, __NEXT_DATA__, API directe).
Lancer: uv run python tests/test_maxi_scraper.py
"""
import asyncio
import re
import json
import logging

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger(__name__)

MAXI_STORE_ID = "8676"
TEST_INGREDIENTS = ["poulet", "ail", "lait 2%", "pâtes fusilli", "beurre", "oeufs"]


def is_relevant(query: str, product_name: str) -> bool:
    if not product_name:
        return False
    def norm(s):
        import unicodedata
        s = unicodedata.normalize("NFD", s.lower())
        s = "".join(c for c in s if unicodedata.category(c) != "Mn")
        return re.sub(r"[^a-z0-9\s]", "", s)
    q = norm(query)
    p = norm(product_name)
    words = [w for w in q.split() if len(w) >= 2]
    if not words:
        return q in p
    matches = sum(1 for w in words if re.search(rf"\b{re.escape(w)}\b", p))
    return (matches / len(words)) >= 0.6


def parse_format(product_name: str) -> dict:
    if not product_name:
        return {"qty": 1, "unit": "unite"}
    # Multi-pack: "24 x 500 ml"
    m = re.search(r"(\d+)\s*x\s*(\d+[\.,]?\d*)\s*(g|kg|ml|l|lb|oz)\b", product_name, re.I)
    if m:
        total = float(m.group(1)) * float(m.group(2).replace(",", "."))
        return {"qty": round(total, 2), "unit": m.group(3).lower()}
    # Single: "454 g"
    m = re.search(r"(\d+[\.,]?\d*)\s*(g|kg|ml|l|lb|oz)\b", product_name, re.I)
    if m:
        return {"qty": float(m.group(1).replace(",", ".")), "unit": m.group(2).lower()}
    return {"qty": 1, "unit": "unite"}


async def search_maxi(page, query: str) -> dict | None:
    search_url = f"https://www.maxi.ca/en/search?search-bar={query}&storeId={MAXI_STORE_ID}"
    intercepted: list[dict] = []

    async def on_response(response):
        url = response.url
        if any(k in url for k in ["product-facade", "pcxcdn.com", "maxi.ca/api", "loblaw.ca/v"]):
            if "search" in url and not url.endswith(".html"):
                try:
                    body = await response.json()
                    results = body.get("results") or body.get("data", {}).get("products") or []
                    if results:
                        intercepted.extend(results[:3])
                except Exception:
                    pass

    page.on("response", on_response)
    try:
        await page.goto(search_url, wait_until="networkidle", timeout=30000)
    except Exception:
        pass  # networkidle timeout OK
    page.remove_listener("response", on_response)

    # Strategy 1: Intercepted API
    for p in intercepted:
        price = (p.get("prices", {}) or {}).get("price", {}).get("value") or \
                p.get("price", {}).get("value") or p.get("currentPrice") or 0
        name = p.get("name") or p.get("title") or p.get("displayName") or ""
        if price and price < 75 and is_relevant(query, name):
            fmt = parse_format(name)
            log.info(f"  ✅ [API intercept] {name} → {price}$ ({fmt})")
            return {"strategy": "api_intercept", "name": name, "price": float(price), **fmt}

    # Strategy 2: __NEXT_DATA__
    try:
        nxt = await page.evaluate("""() => {
            try {
                const el = document.querySelector('#__NEXT_DATA__');
                if (!el) return null;
                const data = JSON.parse(el.textContent);
                for (const path of [
                    data?.props?.pageProps?.searchData?.results,
                    data?.props?.pageProps?.initialData?.results,
                    data?.props?.pageProps?.products,
                ]) {
                    if (Array.isArray(path) && path.length) return path[0];
                }
            } catch(e) {}
            return null;
        }""")
        if nxt:
            price = (nxt.get("prices", {}) or {}).get("price", {}).get("value") or \
                    nxt.get("price", {}).get("value") or 0
            name = nxt.get("name") or ""
            if price and is_relevant(query, name):
                fmt = parse_format(name)
                log.info(f"  ✅ [__NEXT_DATA__] {name} → {price}$ ({fmt})")
                return {"strategy": "next_data", "name": name, "price": float(price), **fmt}
    except Exception:
        pass

    # Strategy 3: Direct Loblaw API via page.evaluate fetch
    try:
        api_url = f"https://www.maxi.ca/api/products/ca/en/{MAXI_STORE_ID}/search?query={query}&sortBy=relevance&pageSize=3"
        resp = await page.evaluate(f"""async () => {{
            try {{
                const r = await fetch({json.dumps(api_url)}, {{headers:{{'Accept':'application/json'}}}});
                if (!r.ok) return null;
                return await r.json();
            }} catch(e) {{ return null; }}
        }}""")
        results = (resp or {}).get("results") or (resp or {}).get("products") or []
        for p in results:
            price = (p.get("prices", {}) or {}).get("price", {}).get("value") or \
                    p.get("price", {}).get("value") or float(p.get("price") or 0)
            name = p.get("name") or p.get("title") or ""
            if price and is_relevant(query, name):
                fmt = parse_format(name)
                log.info(f"  ✅ [Direct API] {name} → {price}$ ({fmt})")
                return {"strategy": "direct_api", "name": name, "price": float(price), **fmt}
    except Exception as e:
        log.warning(f"  Direct API error: {e}")

    log.warning(f"  ❌ No result for '{query}'")
    return None


async def main():
    from playwright.async_api import async_playwright
    log.info(f"🧪 Test Maxi scraper — store #{MAXI_STORE_ID}")
    log.info(f"Ingrédients: {TEST_INGREDIENTS}\n")

    results = {}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
        await ctx.route("**/*.{png,jpg,jpeg,gif,webp,woff,woff2,css,svg}", lambda r: r.abort())

        page = await ctx.new_page()

        for ing in TEST_INGREDIENTS:
            log.info(f"🔍 Recherche: '{ing}'")
            result = await search_maxi(page, ing)
            results[ing] = result

        await browser.close()

    log.info("\n" + "="*60)
    log.info("RÉSUMÉ")
    log.info("="*60)
    ok = sum(1 for v in results.values() if v)
    log.info(f"Trouvés: {ok}/{len(TEST_INGREDIENTS)}")
    for ing, r in results.items():
        if r:
            log.info(f"  ✅ {ing:20} → {r['price']:.2f}$ | {r['qty']} {r['unit']} | [{r['strategy']}]")
        else:
            log.info(f"  ❌ {ing:20} → pas trouvé")


if __name__ == "__main__":
    asyncio.run(main())
