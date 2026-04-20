"""
Celery task: map IngredientMaster -> StoreProduct via Maxi + Costco scrapers.
Iterates over all ingredients with price_mapping_status != 'mapped',
persists best matches into StoreProduct and broadcasts progress via WebSocket.
"""
import asyncio
import json
import logging
from datetime import datetime

from app.workers.celery_app import celery_app
from app.config import settings

logger = logging.getLogger(__name__)

BATCH_SIZE = 5  # parallel Playwright pages per store
STORES = ("maxi", "costco")
SCRAPE_TIMEOUT_S = 45  # hard deadline per ingredient scrape (prevents infinite hangs)


@celery_app.task(bind=True, name="prices.map")
def run_price_mapping(self, job_id: int, store_codes: list[str] | None = None, ingredient_ids: list[int] | None = None):
    asyncio.run(_run(job_id, store_codes, ingredient_ids))


async def _run(job_id: int, store_codes: list[str] | None, ingredient_ids: list[int] | None):
    from playwright.async_api import async_playwright
    from sqlalchemy import select, or_
    from app.database import AsyncSessionLocal, init_db
    from app.models.job import ImportJob
    from app.models.ingredient import IngredientMaster
    from app.models.store import Store, StoreProduct, PriceHistory
    from app.scrapers.maxi import search_maxi
    from app.scrapers.costco import search_costco
    from app.websocket.manager import manager

    codes = [c for c in (store_codes or STORES) if c in STORES]
    await init_db()

    async with AsyncSessionLocal() as db:
        job = await db.get(ImportJob, job_id)
        if not job:
            return
        job.status = "running"
        job.started_at = datetime.utcnow()

        stores_q = select(Store).where(Store.code.in_(codes))
        stores = {s.code: s for s in (await db.execute(stores_q)).scalars().all()}

        ing_q = select(IngredientMaster)
        if ingredient_ids:
            ing_q = ing_q.where(IngredientMaster.id.in_(ingredient_ids))
        else:
            ing_q = ing_q.where(
                or_(
                    IngredientMaster.price_mapping_status.is_(None),
                    IngredientMaster.price_mapping_status != "mapped",
                )
            )
        ingredients = list((await db.execute(ing_q)).scalars().all())

        job.progress_total = len(ingredients) * len(codes)
        await db.commit()

    if not ingredients or not stores:
        async with AsyncSessionLocal() as db:
            job = await db.get(ImportJob, job_id)
            if job:
                job.status = "completed"
                job.finished_at = datetime.utcnow()
                await db.commit()
        await manager.broadcast(str(job_id), {"job_id": job_id, "status": "completed", "processed": 0})
        return

    scrapers = {"maxi": search_maxi, "costco": search_costco}
    errors: list[str] = []
    processed = 0
    total = len(ingredients) * len(codes)
    cancelled = False

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

        for code in codes:
            if cancelled:
                break
            store = stores.get(code)
            if not store:
                continue
            scraper = scrapers[code]
            store_id_param = store.store_location_id or ""

            for chunk_start in range(0, len(ingredients), BATCH_SIZE):
                # Cooperative cancellation check between chunks
                async with AsyncSessionLocal() as db:
                    job = await db.get(ImportJob, job_id)
                    if job and job.cancel_requested:
                        cancelled = True
                        break

                chunk = ingredients[chunk_start: chunk_start + BATCH_SIZE]

                async def _scrape_guarded(page, query: str, sid: str):
                    try:
                        return await asyncio.wait_for(
                            scraper(page, query, sid), timeout=SCRAPE_TIMEOUT_S,
                        )
                    except asyncio.TimeoutError:
                        return TimeoutError(f"timeout>{SCRAPE_TIMEOUT_S}s")

                tasks = [
                    _scrape_guarded(pages[j], ing.display_name_fr or ing.canonical_name.replace("_", " "), store_id_param)
                    for j, ing in enumerate(chunk)
                ]
                results = await asyncio.gather(*tasks, return_exceptions=True)

                async with AsyncSessionLocal() as db:
                    for ing, result in zip(chunk, results):
                        ing_db = await db.get(IngredientMaster, ing.id)
                        if not ing_db:
                            continue
                        if isinstance(result, Exception) or not result:
                            errors.append(f"{code}:{ing.canonical_name}: miss")
                            continue

                        # Upsert StoreProduct (ingredient+store+sku unique constraint)
                        sp_q = select(StoreProduct).where(
                            StoreProduct.ingredient_master_id == ing.id,
                            StoreProduct.store_id == store.id,
                        )
                        product = (await db.execute(sp_q)).scalars().first()
                        if not product:
                            product = StoreProduct(
                                ingredient_master_id=ing.id,
                                store_id=store.id,
                            )
                            db.add(product)

                        old_price = product.price
                        product.product_name = result.get("product_name")
                        product.product_url = result.get("product_url")
                        product.price = result.get("price")
                        product.format_qty = result.get("format_qty")
                        product.format_unit = result.get("format_unit")
                        product.calories_per_100 = result.get("calories")
                        product.proteins_per_100 = result.get("proteins")
                        product.carbs_per_100 = result.get("carbs")
                        product.lipids_per_100 = result.get("lipids")
                        product.nutriscore = result.get("nutriscore")
                        product.is_validated = True
                        product.confidence_score = 0.9
                        product.last_checked_at = datetime.utcnow()
                        if old_price != product.price:
                            product.last_price_change_at = datetime.utcnow()
                        await db.flush()

                        if product.price is not None:
                            db.add(PriceHistory(store_product_id=product.id, price=product.price))

                        ing_db.price_mapping_status = "mapped"
                        ing_db.last_price_mapping_at = datetime.utcnow()

                        processed += 1
                    await db.commit()

                # Update job progress + broadcast
                async with AsyncSessionLocal() as db:
                    job = await db.get(ImportJob, job_id)
                    if job:
                        job.progress_current = min(job.progress_current + len(chunk), total)
                        job.current_item = f"{code}:{chunk[-1].canonical_name}"
                        await db.commit()

                await manager.broadcast(
                    str(job_id),
                    {
                        "job_id": job_id,
                        "current": min(processed, total),
                        "total": total,
                        "processed": processed,
                        "errors": len(errors),
                        "store": code,
                    },
                )

        await browser.close()

    final_status = "cancelled" if cancelled else "completed"

    async with AsyncSessionLocal() as db:
        job = await db.get(ImportJob, job_id)
        if job:
            job.status = final_status
            job.finished_at = datetime.utcnow()
            if not cancelled:
                job.progress_current = total
            job.error_log = json.dumps(errors[:200])
            await db.commit()

    await manager.broadcast(
        str(job_id),
        {"job_id": job_id, "status": final_status, "processed": processed, "errors": len(errors)},
    )
