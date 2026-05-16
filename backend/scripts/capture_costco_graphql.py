"""Capture the full GraphQL request body + response for a Costco search.

Found earlier that POST https://ecom-api.costco.com/ebusiness/product/v1/products/graphql
returns product data. Here we grab the full request so we can reproduce it.
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from patchright.async_api import async_playwright  # noqa: E402
from app.scrapers._utils import try_accept_cookies  # noqa: E402


OUT = Path(__file__).resolve().parent.parent / "debug" / "costco" / f"graphql_{int(time.time())}.jsonl"
OUT.parent.mkdir(parents=True, exist_ok=True)


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            channel="chrome", headless=False,
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

        captured: list[dict] = []

        async def on_request(req):
            if "graphql" not in req.url:
                return
            try:
                body = req.post_data or ""
                entry = {
                    "method": req.method,
                    "url": req.url,
                    "headers": dict(req.headers),
                    "body": body,
                }
                captured.append(entry)
                with OUT.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            except Exception as e:
                print(f"err: {e}")

        page.on("request", lambda r: asyncio.create_task(on_request(r)))

        # warm-up
        await page.goto("https://www.costco.ca/", wait_until="domcontentloaded", timeout=40000)
        await page.wait_for_timeout(5000)
        await try_accept_cookies(page)
        await page.evaluate(
            "document.querySelector('#onetrust-consent-sdk')?.remove();"
        )

        for term in ["eggs", "butter"]:
            await page.goto(f"https://www.costco.ca/s?dept=All&keyword={term}",
                            wait_until="domcontentloaded", timeout=40000)
            await page.wait_for_timeout(6000)
            await page.evaluate("window.scrollBy(0, 600)")
            await page.wait_for_timeout(2500)

        # cookies
        ck = {c["name"]: c["value"] for c in await context.cookies()}
        print(f"\n==== {len(captured)} graphql requests captured ====")
        for i, e in enumerate(captured, 1):
            body = e.get("body") or ""
            try:
                parsed = json.loads(body) if body else {}
            except Exception:
                parsed = {"raw": body}
            op = parsed.get("operationName") if isinstance(parsed, dict) else None
            vars_ = parsed.get("variables", {}) if isinstance(parsed, dict) else {}
            print(f"\n#{i}  op={op}  body_len={len(body)}")
            print("  variables:", json.dumps(vars_, ensure_ascii=False)[:250])
            if isinstance(parsed, dict) and "query" in parsed:
                q = parsed["query"]
                print("  query (first 500c):", q[:500].replace("\n", " "))

        print(f"\n==== cookies that contain 'costco'/'ecom' ====")
        for k, v in ck.items():
            if any(x in k.lower() for x in ("storeloc", "costco", "ecom", "_csrf", "abck", "bm_")):
                print(f"  {k}: {v[:80]}")

        print(f"\nsaved: {OUT}")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
