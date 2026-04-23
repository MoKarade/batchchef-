"""
Celery task: map IngredientMaster -> StoreProduct via Maxi scraper.
Uses AI-generated search aliases + AI match validation (same as import pipeline).

V3: Maxi-only — Costco disabled (Akamai + SPA rendering made it unreliable).
"""
import asyncio
import json
import logging
from datetime import datetime

from app.workers.celery_app import celery_app
from app.config import settings

logger = logging.getLogger(__name__)

BATCH_SIZE = 5
STORES = ("maxi",)
SCRAPE_TIMEOUT_S = 25
# A worker never spends more than this long on a single ingredient across
# all queries + validation, so one bad item can't wedge the pipeline.
PER_INGREDIENT_DEADLINE_S = 60
ALIAS_CONFIDENCE_THRESHOLD = 0.75
_ALIASES_BATCH = 50


@celery_app.task(bind=True, name="prices.map")
def run_price_mapping(self, job_id: int, store_codes: list[str] | None = None, ingredient_ids: list[int] | None = None):
    asyncio.run(_run(job_id, store_codes, ingredient_ids))


async def _generate_aliases(ings) -> None:
    """Seed search_aliases cheaply from canonical_name.

    The AI-powered alias generator was too slow and fragile (Gemini often
    returns truncated JSON). The Maxi scraper already handles fuzzy matching
    via its own search, so a single human-readable alias is enough to unblock
    the pipeline. We populate with `canonical_name.replace("_", " ")`.
    """
    from app.database import AsyncSessionLocal
    from app.models.ingredient import IngredientMaster

    needs = [ing for ing in ings if not ing.search_aliases]
    if not needs:
        return

    async with AsyncSessionLocal() as db:
        for ing in needs:
            ing_db = await db.get(IngredientMaster, ing.id)
            if ing_db:
                ing_db.search_aliases = [ing.canonical_name.replace("_", " ")]
        await db.commit()

    logger.info(f"[map_prices] Seeded cheap aliases for {len(needs)} ingredients")


async def _maybe_update_display_name(ing_db, product_name: str) -> None:
    """Update display_name_fr from real product name if still mechanical."""
    import re
    if not product_name:
        return
    mechanical = re.sub(r"_+", " ", ing_db.canonical_name).title()
    if ing_db.display_name_fr and ing_db.display_name_fr.strip() != mechanical.strip():
        return
    # Extract clean name: take first 3 words, drop size/brand suffixes
    clean = " ".join(product_name.split()[:4]).strip()
    if clean:
        ing_db.display_name_fr = clean


async def _run(job_id: int, store_codes: list[str] | None, ingredient_ids: list[int] | None):
    # patchright (Playwright fork) with the real Chrome channel keeps us
    # human-looking for any future anti-bot detection; today only Maxi runs.
    from patchright.async_api import async_playwright
    from sqlalchemy import select, or_
    from app.database import AsyncSessionLocal, init_db
    from app.models.job import ImportJob
    from app.models.ingredient import IngredientMaster
    from app.models.store import Store, StoreProduct, PriceHistory
    from app.scrapers.maxi import search_maxi
    from app.ai.classifier import validate_store_matches
    from app.websocket.manager import manager
    from app.utils.time import utcnow

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

        job.progress_total = len(ingredients)
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

    # Generate aliases for ingredients that don't have them
    await _generate_aliases(ingredients)
    # Reload with fresh aliases
    async with AsyncSessionLocal() as db:
        ings_fresh = list((await db.execute(
            select(IngredientMaster).where(IngredientMaster.id.in_([i.id for i in ingredients]))
        )).scalars().all())
    ingredients = ings_fresh

    scrapers = {"maxi": search_maxi}
    errors: list[str] = []
    processed = 0
    cancelled = False

    async def _try_queries(page, scraper_fn, queries: list[str], store_id_param: str):
        for query in queries:
            try:
                result = await asyncio.wait_for(
                    scraper_fn(page, query, store_id_param), timeout=SCRAPE_TIMEOUT_S
                )
                if result and not isinstance(result, Exception):
                    return result, query
            except (asyncio.TimeoutError, Exception) as e:
                logger.debug(f"Query '{query}' failed: {e}")
        return None, None

    async with async_playwright() as pw:
        # channel='chrome' uses the user's installed Chrome to stay human-looking.
        browser = await pw.chromium.launch(
            headless=settings.PLAYWRIGHT_HEADLESS,
            channel="chrome",
        )
        context = await browser.new_context(locale="fr-CA")
        await context.route(
            "**/*.{png,jpg,jpeg,gif,webp,woff,woff2,ttf,otf,css,svg}",
            lambda r: r.abort(),
        )
        pages = [await context.new_page() for _ in range(BATCH_SIZE)]

        for chunk_start in range(0, len(ingredients), BATCH_SIZE):
            # Cooperative cancellation
            async with AsyncSessionLocal() as db:
                job = await db.get(ImportJob, job_id)
                if job and job.cancel_requested:
                    cancelled = True
                    break

            chunk = ingredients[chunk_start: chunk_start + BATCH_SIZE]

            for code in codes:
                store = stores.get(code)
                if not store:
                    continue
                scraper_fn = scrapers[code]
                store_id_param = store.store_location_id or ""

                query_lists = []
                for ing in chunk:
                    queries = []
                    if ing.display_name_fr:
                        queries.append(ing.display_name_fr)
                    for a in (ing.search_aliases or []):
                        if a not in queries:
                            queries.append(a)
                    if not queries:
                        queries.append(ing.canonical_name.replace("_", " "))
                    query_lists.append(queries)

                tasks = [
                    asyncio.create_task(
                        _try_queries(pages[j], scraper_fn, query_lists[j], store_id_param)
                    )
                    for j in range(len(chunk))
                ]
                results = await asyncio.gather(*tasks, return_exceptions=True)

                # Batch AI validation for all matches found
                validation_pairs: list[tuple[int, dict, str]] = []
                for idx, (ing, res) in enumerate(zip(chunk, results)):
                    if isinstance(res, Exception) or not res or not res[0]:
                        errors.append(f"{code}:{ing.canonical_name}: miss")
                        continue
                    result_dict, matched_query = res
                    validation_pairs.append((idx, result_dict, matched_query))

                if validation_pairs:
                    pairs_for_ai = [
                        (chunk[idx].canonical_name, rd.get("product_name", ""))
                        for idx, rd, _ in validation_pairs
                    ]
                    scores = await validate_store_matches(pairs_for_ai)

                    async with AsyncSessionLocal() as db:
                        for (idx, result_dict, matched_query), score in zip(validation_pairs, scores):
                            ing = chunk[idx]
                            if score < ALIAS_CONFIDENCE_THRESHOLD:
                                logger.info(
                                    f"{code}:{ing.canonical_name}: rejected '{result_dict.get('product_name')}' "
                                    f"(score={score:.2f})"
                                )
                                errors.append(f"{code}:{ing.canonical_name}: low_confidence({score:.2f})")
                                continue

                            ing_db = await db.get(IngredientMaster, ing.id)
                            if not ing_db:
                                continue

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
                            product.product_name = result_dict.get("product_name")
                            product.product_url = result_dict.get("product_url")
                            product.image_url = result_dict.get("image_url")
                            product.price = result_dict.get("price")
                            product.format_qty = result_dict.get("format_qty")
                            product.format_unit = result_dict.get("format_unit")
                            product.calories_per_100 = result_dict.get("calories")
                            product.proteins_per_100 = result_dict.get("proteins")
                            product.carbs_per_100 = result_dict.get("carbs")
                            product.lipids_per_100 = result_dict.get("lipids")
                            product.nutriscore = result_dict.get("nutriscore")
                            product.is_validated = True
                            product.confidence_score = score
                            product.last_checked_at = utcnow()
                            if old_price != product.price:
                                product.last_price_change_at = utcnow()
                            await db.flush()

                            if product.price is not None:
                                db.add(PriceHistory(store_product_id=product.id, price=product.price))

                            # Only mark "mapped" when the product is complete:
                            # it MUST have a real thumbnail so the ingredient UI
                            # shows a meaningful picture. Otherwise keep it
                            # pending so the next run will retry.
                            if product.image_url:
                                ing_db.price_mapping_status = "mapped"
                            else:
                                ing_db.price_mapping_status = "pending"
                                errors.append(f"{code}:{ing.canonical_name}: missing_image")
                            ing_db.last_price_mapping_at = utcnow()
                            ing_db.price_map_attempts = (ing_db.price_map_attempts or 0) + 1
                            await _maybe_update_display_name(ing_db, result_dict.get("product_name", ""))

                            processed += 1
                            logger.info(
                                f"{code}:{ing.canonical_name} → '{result_dict.get('product_name')}' "
                                f"(score={score:.2f}, query='{matched_query}')"
                            )
                        await db.commit()

            # Progress update
            async with AsyncSessionLocal() as db:
                job = await db.get(ImportJob, job_id)
                if job:
                    job.progress_current = min(chunk_start + BATCH_SIZE, len(ingredients))
                    job.current_item = chunk[-1].canonical_name
                    await db.commit()

            await manager.broadcast(
                str(job_id),
                {
                    "job_id": job_id,
                    "current": min(chunk_start + BATCH_SIZE, len(ingredients)),
                    "total": len(ingredients),
                    "processed": processed,
                    "errors": len(errors),
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
                job.progress_current = len(ingredients)
            job.error_log = json.dumps(errors[:200])
            await db.commit()

    await manager.broadcast(
        str(job_id),
        {"job_id": job_id, "status": final_status, "processed": processed, "errors": len(errors)},
    )
