"""Capture every XHR/fetch made by costco.ca while running a typical search.

Run: uv run python scripts/capture_costco_xhr.py

Output:
  backend/debug/costco/xhr_{timestamp}.jsonl  — one line per request
  backend/debug/costco/summary.md             — ranked list of candidate endpoints

We print a ranked list on stdout: endpoints that returned JSON with what
look like product arrays come first.
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from patchright.async_api import async_playwright  # noqa: E402
from app.config import settings  # noqa: E402
from app.scrapers._utils import try_accept_cookies  # noqa: E402


SEARCH_TERMS = ["eggs", "butter", "olive oil", "chicken breast", "rice"]


DEBUG_DIR = Path(__file__).resolve().parent.parent / "debug" / "costco"
DEBUG_DIR.mkdir(parents=True, exist_ok=True)

TS = int(time.time())
OUT_FILE = DEBUG_DIR / f"xhr_{TS}.jsonl"
SUMMARY = DEBUG_DIR / "summary.md"


def looks_like_products_json(body: str) -> tuple[bool, int]:
    """Heuristic: does this response body look like a product search result?
    Returns (is_product_json, estimated_product_count)."""
    if not body:
        return False, 0
    if len(body) < 50:
        return False, 0
    s = body[:500].lower()
    hints = ["product", "price", "sku", "displayname", "product_name", "itemid", "keyword"]
    hits = sum(1 for h in hints if h in s)
    if hits < 2:
        return False, 0
    # Rough product count
    count = body.lower().count('"sku"') + body.lower().count('"itemid"') + body.lower().count('"productid"')
    return True, count


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            channel="chrome",
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1440, "height": 900},
            locale="fr-CA",
        )
        page = await context.new_page()

        # ---- Log every response ----
        captured: list[dict] = []

        async def on_response(resp):
            try:
                url = resp.url
                ctype = resp.headers.get("content-type", "")
                if "costco" not in url:
                    return
                if resp.status >= 400:
                    return
                # Only care about JSON or calls that smell like API
                is_json = "json" in ctype
                is_api_path = any(
                    k in url for k in ("/api/", "/graphql", "/search", "/catalog", "/product")
                )
                if not (is_json or is_api_path):
                    return
                body = await resp.text()
                is_products, count = looks_like_products_json(body) if is_json else (False, 0)
                entry = {
                    "method": resp.request.method,
                    "url": url,
                    "status": resp.status,
                    "content_type": ctype,
                    "length": len(body),
                    "is_products_json": is_products,
                    "product_count_hint": count,
                    "request_headers": dict(resp.request.headers),
                    "response_headers_sample": {
                        k: v for k, v in resp.headers.items()
                        if k.lower() in ("content-type", "x-akamai-*", "set-cookie", "cache-control")
                    },
                    "body_preview": body[:800],
                }
                captured.append(entry)
                with OUT_FILE.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            except Exception as e:
                print(f"capture error: {e}", file=sys.stderr)

        page.on("response", lambda r: asyncio.create_task(on_response(r)))

        # ---- Navigation ----
        print("=== warming up (homepage) ===")
        await page.goto("https://www.costco.ca/", wait_until="domcontentloaded", timeout=40000)
        await page.wait_for_timeout(5000)
        await try_accept_cookies(page)

        # remove OneTrust banner defensively
        await page.evaluate(
            """
            document.querySelector('#onetrust-consent-sdk')?.remove();
            document.querySelectorAll('[class*=OnetrustBanner]').forEach(e => e.remove());
            """
        )
        await page.wait_for_timeout(2000)

        for term in SEARCH_TERMS:
            print(f"\n=== searching '{term}' ===")
            url = f"https://www.costco.ca/s?dept=All&keyword={term}"
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=40000)
            except Exception as e:
                print(f"  goto failed: {e}")
                continue
            await page.wait_for_timeout(6000)  # let XHR fire

            # scroll to trigger lazy loads
            await page.evaluate("window.scrollBy(0, 800)")
            await page.wait_for_timeout(2500)

        await browser.close()

    # ---- Summarize ----
    products_candidates = [e for e in captured if e["is_products_json"]]
    products_candidates.sort(key=lambda e: (-e["product_count_hint"], -e["length"]))

    print(f"\n\n========== SUMMARY ==========")
    print(f"total responses captured: {len(captured)}")
    print(f"products-like responses:  {len(products_candidates)}")
    print()
    for i, e in enumerate(products_candidates[:15], 1):
        print(f"{i}. {e['method']} {e['url'][:100]}")
        print(f"   status={e['status']}  len={e['length']}  product_hits={e['product_count_hint']}")
        print(f"   preview: {e['body_preview'][:150]}")
        print()

    # Markdown summary
    with SUMMARY.open("w", encoding="utf-8") as f:
        f.write(f"# Costco XHR capture — {TS}\n\n")
        f.write(f"- Total responses: {len(captured)}\n")
        f.write(f"- Products-like: {len(products_candidates)}\n\n")
        f.write("## Top candidates\n\n")
        for i, e in enumerate(products_candidates[:20], 1):
            f.write(f"### {i}. `{e['method']} {e['url']}`\n")
            f.write(f"- status: {e['status']}\n")
            f.write(f"- content-type: {e['content_type']}\n")
            f.write(f"- length: {e['length']} bytes, product hits: {e['product_count_hint']}\n")
            f.write(f"```json\n{e['body_preview'][:400]}\n```\n\n")
    print(f"\nFull log:  {OUT_FILE}")
    print(f"Summary:   {SUMMARY}")


if __name__ == "__main__":
    asyncio.run(main())
