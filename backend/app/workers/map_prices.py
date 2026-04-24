"""
Celery task: map IngredientMaster -> StoreProduct via Maxi + Costco scrapers.
Uses AI-generated search aliases + AI match validation (same as import pipeline).

V3: Maxi is the primary source (DOM scraping). Costco uses a sitemap +
GraphQL API combo with per-token position-weighted matching (see
costco_sitemap.search() and costco_api.search_costco() for details).
"""
import asyncio
import json
import logging
from datetime import datetime

from app.workers.celery_app import celery_app
from app.config import settings

logger = logging.getLogger(__name__)

BATCH_SIZE = 5
STORES = ("maxi", "costco")
SCRAPE_TIMEOUT_S = 25

# Hand-curated query fallbacks for high-usage staples whose bare canonical
# name ('beurre', 'crème liquide', etc.) returns too many tangential
# products on Maxi (vegan margarine, cheese spreads, ice-cream bars…).
# Each list is tried in order after the ingredient's own display_name_fr
# + aliases, so the scraper only falls back when the default query hasn't
# yielded a validated match.
_STAPLE_FALLBACK_QUERIES: dict[str, list[str]] = {
    "beurre": ["beurre salé", "beurre non salé", "beurre doux"],
    "beurre_doux": ["beurre non salé", "beurre doux"],
    "beurre_demi_sel": ["beurre demi-sel", "beurre salé"],
    "beurre_fondu": ["beurre salé"],
    "crème_liquide": ["crème 35% à cuisson", "crème champêtre 15%", "crème à cuisson 10%"],
    "crème_fraiche": ["crème sure 14%"],
    "crème_épaisse": ["crème sure"],
    "crème": ["crème 35%", "crème à café 10%"],
    "levure_chimique": ["poudre à pâte", "poudre à pâte fleischmann"],
    "levure_de_boulanger": ["levure sèche active", "levure à pain"],
    "vanille": ["extrait de vanille pure", "extrait vanille", "gousse de vanille"],
    "sucre_vanillé": ["sucre vanillé"],
    "cassonade": ["cassonade dorée", "sucre brun"],
    "sucre_glace": ["sucre à glacer", "sucre en poudre"],
    "lardon": ["lardons fumés", "bacon en dés"],
    "jambon": ["jambon cuit tranché", "jambon cuit"],
    "bouillon": ["cube de bouillon", "bouillon de poulet"],
    "pâte_feuilletée": ["pâte feuilletée tenderflake", "pâte à tarte congelée"],
    "pâte_brisée": ["pâte brisée", "pâte à tarte"],
    "ciboulette": ["ciboulette fraîche"],
    "persil": ["persil frais italien", "persil"],
    "thym": ["thym frais", "thym séché"],
    "basilic": ["basilic frais", "basilic"],
    "menthe": ["menthe fraîche"],
    "gousse_dail": ["ail frais", "ail"],
    "huile_olive": ["huile d'olive extra-vierge"],
    "huile_de_tournesol": ["huile de tournesol"],
    "moutarde": ["moutarde de dijon"],
    "moutarde_dijon": ["moutarde de dijon"],
}
# A worker never spends more than this long on a single ingredient across
# all queries + validation, so one bad item can't wedge the pipeline.
PER_INGREDIENT_DEADLINE_S = 60
ALIAS_CONFIDENCE_THRESHOLD = 0.75
_ALIASES_BATCH = 50


@celery_app.task(bind=True, name="prices.map")
def run_price_mapping(self, job_id: int, store_codes: list[str] | None = None, ingredient_ids: list[int] | None = None):
    """Same dedup-lock pattern as import_marmiton — one running copy per
    job_id, even if the broker delivers the task to two workers."""
    from app.utils.task_lock import redis_lock

    with redis_lock(f"price_mapping:{job_id}", ttl=6 * 3600) as acquired:
        if not acquired:
            logger.warning("price_mapping job #%d already running — skipping duplicate", job_id)
            return
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
    # channel='chrome' keeps us human-looking for anti-bot detection.
    from patchright.async_api import async_playwright
    from sqlalchemy import select, or_
    from app.database import AsyncSessionLocal, init_db
    from app.models.job import ImportJob
    from app.models.ingredient import IngredientMaster
    from app.models.store import Store, StoreProduct, PriceHistory
    from app.scrapers.maxi import search_maxi
    from app.scrapers.costco_api import search_costco
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

        # Price ONLY canonical parents. Variants inherit their parent's
        # StoreProduct through the hierarchy — scraping a variant ("boîte de
        # thon 200g") separately would waste requests and never find a
        # cleaner match than the parent ("thon") already did.
        #
        # ORDER BY usage count DESC — a single run that processes 'beurre'
        # (used in 2921 recipes) unlocks way more recipe coverage than 500
        # random long-tail items. When the job is interrupted, we lose the
        # tail (low-value) not the head.
        #
        # Performance: we used to compute usage on-the-fly via a self-join
        # on ingredient_master × ingredient_master × recipe_ingredient. On
        # 21k×240k rows that took >10 min (jobs #80-82 never started).
        # Now we read a pre-computed ``usage_count`` column maintained by
        # ``app.services.ingredient_usage.refresh_usage_counts``. Init is
        # instant.
        ing_q = (
            select(IngredientMaster)
            .where(IngredientMaster.parent_id.is_(None))
            .where(
                or_(
                    IngredientMaster.price_mapping_status.is_(None),
                    IngredientMaster.price_mapping_status != "invalid",
                )
            )
        )
        if ingredient_ids:
            ing_q = ing_q.where(IngredientMaster.id.in_(ingredient_ids))
        else:
            ing_q = ing_q.where(
                or_(
                    IngredientMaster.price_mapping_status.is_(None),
                    IngredientMaster.price_mapping_status != "mapped",
                )
            )
        ing_q = ing_q.order_by(
            IngredientMaster.usage_count.desc(),
            IngredientMaster.id.asc(),
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

    scrapers = {"maxi": search_maxi, "costco": search_costco}
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

    # Supervised Playwright session: if the browser crashes mid-run (patchright
    # sometimes throws "value: expected integer, got object" from a background
    # Future), we close it and relaunch. Each restart resumes at chunk_start.
    chunk_start = 0
    restart_count = 0
    max_restarts = 10
    while chunk_start < len(ingredients):
        try:
            async with async_playwright() as pw:
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

                while chunk_start < len(ingredients):
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
                            queries: list[str] = []
                            # Staple fallbacks come FIRST for known-bad-default
                            # ingredients. _try_queries returns on the first
                            # non-empty result (validation happens later), so
                            # a bare 'beurre' query would latch onto 'Becel
                            # Beurre végétal' and never try the good query.
                            # Putting 'beurre salé' first gives us the real
                            # product straight away.
                            for fb in _STAPLE_FALLBACK_QUERIES.get(ing.canonical_name, []):
                                if fb not in queries:
                                    queries.append(fb)
                            # Default ingredient display name + aliases as
                            # the fallback path if none of the staple queries
                            # matched (or if there were none).
                            if ing.display_name_fr and ing.display_name_fr not in queries:
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

                        # --- Validate + persist THIS store's results ---
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
                                            f"{code}:{ing.canonical_name}: rejected "
                                            f"'{result_dict.get('product_name')}' (score={score:.2f})"
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

                                    # Only mark "mapped" when we have a thumbnail
                                    # too — otherwise keep pending for retry.
                                    if product.image_url:
                                        ing_db.price_mapping_status = "mapped"
                                    else:
                                        ing_db.price_mapping_status = "pending"
                                        errors.append(f"{code}:{ing.canonical_name}: missing_image")
                                    ing_db.last_price_mapping_at = utcnow()
                                    ing_db.price_map_attempts = (ing_db.price_map_attempts or 0) + 1
                                    await _maybe_update_display_name(
                                        ing_db, result_dict.get("product_name", "")
                                    )

                                    processed += 1
                                    logger.info(
                                        f"{code}:{ing.canonical_name} → "
                                        f"'{result_dict.get('product_name')}' "
                                        f"(score={score:.2f}, query='{matched_query}')"
                                    )
                                await db.commit()
                    # end for code in codes

                    # --- Progress update PER CHUNK ---
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

                    # Advance cursor — one chunk at a time so a crash mid-
                    # chunk doesn't lose work on the next restart.
                    chunk_start += BATCH_SIZE
                # end while chunk_start

                if cancelled:
                    break
                await browser.close()
                break  # normal exit — all ingredients processed
        except Exception as supervised_exc:
            restart_count += 1
            logger.warning(
                f"Playwright session crashed (attempt {restart_count}/{max_restarts}) "
                f"at chunk_start={chunk_start}: {supervised_exc}. Restarting..."
            )
            if restart_count >= max_restarts:
                logger.error(f"Max Playwright restarts ({max_restarts}) exceeded; aborting.")
                errors.append(f"playwright_supervisor: max restarts exceeded ({supervised_exc})")
                break
            await asyncio.sleep(3.0)

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
