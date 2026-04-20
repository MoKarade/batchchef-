"""
Celery task: periodic price validation across all validated StoreProduct rows.
Re-scrapes Maxi/Costco, appends PriceHistory when the price changes,
refreshes last_checked_at. Runs weekly via Celery Beat.
"""
import asyncio
import logging
from datetime import datetime, timedelta

from app.workers.celery_app import celery_app
from app.config import settings

logger = logging.getLogger(__name__)

STALE_AFTER_DAYS = 7
BATCH_SIZE = 5


@celery_app.task(bind=True, name="prices.validate")
def run_price_validation(self, max_items: int | None = None):
    asyncio.run(_run(max_items))


async def _run(max_items: int | None):
    from playwright.async_api import async_playwright
    from sqlalchemy import select, or_
    from sqlalchemy.orm import selectinload
    from app.database import AsyncSessionLocal, init_db
    from app.models.store import Store, StoreProduct, PriceHistory
    from app.scrapers.maxi import search_maxi
    from app.scrapers.costco import search_costco

    await init_db()
    scrapers = {"maxi": search_maxi, "costco": search_costco}
    cutoff = datetime.utcnow() - timedelta(days=STALE_AFTER_DAYS)

    async with AsyncSessionLocal() as db:
        q = (
            select(StoreProduct)
            .options(selectinload(StoreProduct.store), selectinload(StoreProduct.ingredient))
            .where(
                StoreProduct.is_validated == True,  # noqa: E712
                or_(
                    StoreProduct.last_checked_at.is_(None),
                    StoreProduct.last_checked_at < cutoff,
                ),
            )
            .order_by(StoreProduct.last_checked_at.asc().nullsfirst())
        )
        if max_items:
            q = q.limit(max_items)
        products = list((await db.execute(q)).scalars().all())

    if not products:
        logger.info("validate_prices: nothing to refresh")
        return

    logger.info(f"validate_prices: refreshing {len(products)} products")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=settings.PLAYWRIGHT_HEADLESS)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
        await context.route(
            "**/*.{png,jpg,jpeg,gif,webp,woff,woff2,ttf,otf,css,svg}",
            lambda r: r.abort(),
        )
        pages = [await context.new_page() for _ in range(BATCH_SIZE)]

        changed = 0
        for i in range(0, len(products), BATCH_SIZE):
            chunk = products[i: i + BATCH_SIZE]
            tasks = []
            for j, p in enumerate(chunk):
                store_code = p.store.code if p.store else None
                scraper = scrapers.get(store_code)
                if not scraper:
                    tasks.append(asyncio.sleep(0, result=None))
                    continue
                query = p.ingredient.display_name_fr or p.ingredient.canonical_name.replace("_", " ")
                store_id_param = p.store.store_location_id or ""
                tasks.append(scraper(pages[j], query, store_id_param))
            results = await asyncio.gather(*tasks, return_exceptions=True)

            async with AsyncSessionLocal() as db:
                for p, result in zip(chunk, results):
                    db_product = await db.get(StoreProduct, p.id)
                    if not db_product:
                        continue
                    if isinstance(result, Exception) or not result:
                        db_product.last_checked_at = datetime.utcnow()
                        continue

                    new_price = result.get("price")
                    if new_price is not None and new_price != db_product.price:
                        db.add(PriceHistory(store_product_id=db_product.id, price=new_price))
                        db_product.price = new_price
                        db_product.last_price_change_at = datetime.utcnow()
                        changed += 1

                    db_product.product_name = result.get("product_name") or db_product.product_name
                    db_product.product_url = result.get("product_url") or db_product.product_url
                    db_product.format_qty = result.get("format_qty") or db_product.format_qty
                    db_product.format_unit = result.get("format_unit") or db_product.format_unit
                    db_product.last_checked_at = datetime.utcnow()
                await db.commit()

        await browser.close()

    logger.info(f"validate_prices: done. Prices changed on {changed}/{len(products)} products.")
