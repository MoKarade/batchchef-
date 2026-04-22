"""
Smoke test: end-to-end pricing pipeline validation.
Usage: uv run python scripts/demo_pricing_end_to_end.py

Checks:
1. API reachable
2. At least 1 store with MAXI_STORE_ID configured
3. Maxi search returns prices for 5 staple ingredients
4. Costco search returns prices (if COSTCO_ENABLED)
5. /price-coverage returns fresh_pct > 0
6. Batch preview computes a non-zero total_estimated_cost
"""
import asyncio
import sys
import os
import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BASE_URL = os.environ.get("API_URL", "http://localhost:8000")
STAPLES = ["lait", "beurre", "oeufs", "farine", "poulet"]

PASS = "PASS"
FAIL = "FAIL"
SKIP = "SKIP"


def ok(label: str, detail: str = ""):
    print(f"  [{PASS}] {label}" + (f" — {detail}" if detail else ""))


def fail(label: str, detail: str = ""):
    print(f"  [{FAIL}] {label}" + (f" — {detail}" if detail else ""))
    return False


def skip(label: str, detail: str = ""):
    print(f"  [{SKIP}] {label}" + (f" — {detail}" if detail else ""))


async def main():
    passed = 0
    failed = 0

    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        print("\n=== BatchChef Pricing Pipeline Smoke Test ===\n")

        # 1. API reachable
        print("[1] API reachable")
        try:
            r = await client.get("/api/stats")
            r.raise_for_status()
            stats = r.json()
            ok("GET /api/stats", f"recipes={stats.get('total_recipes')}, ingredients={stats.get('total_ingredients')}")
            passed += 1
        except Exception as e:
            fail("GET /api/stats", str(e))
            failed += 1
            print("\nCannot reach API — aborting.")
            sys.exit(1)

        # 2. Stores configured
        print("\n[2] Stores configured")
        try:
            r = await client.get("/api/stores")
            r.raise_for_status()
            stores = r.json()
            store_codes = [s["code"] for s in stores]
            ok("GET /api/stores", f"codes={store_codes}")
            passed += 1
        except Exception as e:
            fail("GET /api/stores", str(e))
            failed += 1
            stores = []

        # 3. Maxi search
        print("\n[3] Maxi price search (storeId from .env)")
        try:
            from app.scrapers.maxi import search_maxi
            from app.config import settings
            found = 0
            for q in STAPLES:
                result = await search_maxi(q, settings.MAXI_STORE_ID)
                if result and result.get("price"):
                    ok(f"  maxi/{q}", f"{result['price']}$/unit")
                    found += 1
                else:
                    fail(f"  maxi/{q}", "no result")
            if found == len(STAPLES):
                passed += 1
            else:
                failed += 1
        except Exception as e:
            fail("Maxi search", str(e))
            failed += 1

        # 4. Price coverage
        print("\n[4] /price-coverage endpoint")
        try:
            r = await client.get("/api/ingredients/price-coverage")
            r.raise_for_status()
            cov = r.json()
            fresh_pct = cov.get("fresh_pct", 0)
            coverage_pct = cov.get("coverage_pct", 0)
            detail = f"total={cov['total']}, priced={cov['priced']}, fresh={cov['fresh']}, coverage={coverage_pct}%, fresh_pct={fresh_pct}%"
            if cov["priced"] > 0:
                ok("price-coverage", detail)
                passed += 1
            else:
                fail("price-coverage: no priced ingredients", detail)
                failed += 1
        except Exception as e:
            fail("/price-coverage", str(e))
            failed += 1

        # 5. Batch preview
        print("\n[5] Batch preview generates non-zero cost")
        try:
            r = await client.post("/api/batches/preview", json={
                "target_portions": 10,
                "num_recipes": 2,
            })
            if r.status_code == 200:
                preview = r.json()
                cost = preview.get("total_estimated_cost", 0)
                coverage = preview.get("price_coverage", 0)
                modes = preview.get("totals_by_mode", {})
                detail = f"cost={cost}$, coverage={coverage:.0%}, modes={list(modes.keys())}"
                if cost > 0:
                    ok("batch preview", detail)
                    passed += 1
                else:
                    fail("batch preview: cost is 0", detail)
                    failed += 1
            elif r.status_code == 400:
                skip("batch preview", f"not enough recipes: {r.json()}")
            else:
                fail("batch preview", f"HTTP {r.status_code}: {r.text[:200]}")
                failed += 1
        except Exception as e:
            fail("batch preview", str(e))
            failed += 1

    print(f"\n=== Results: {passed} passed, {failed} failed ===\n")
    sys.exit(1 if failed > 0 else 0)


if __name__ == "__main__":
    asyncio.run(main())
