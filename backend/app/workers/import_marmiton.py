"""
Celery task: bulk Marmiton import pipeline (V3: Maxi-only).
For each URL:
  1. Pre-filter URLs already in DB (skip scraped/ai_done/error)
  2. Scrape with Playwright (3 retries per URL)
  3. AI standardize ingredient names (batched 50/req, 5 retries with backoff)
  4. AI classify recipe (5 retries with backoff)
  5. Persist Recipe + RecipeIngredient in DB (isolated per recipe)
  6. AI generate search aliases for new IngredientMaster rows
  7. Deduplicate new ingredients against existing ones
  8. Scrape Maxi for new canonical parent ingredients (synchronous, inline)
  9. Gate each recipe: pricing_status=complete only when 100% ingredients have a price
  10. Broadcast progress via WebSocket manager
"""
import asyncio
import json
import logging
from slugify import slugify
from app.utils.time import utcnow

from app.workers.celery_app import celery_app
from app.config import settings

logger = logging.getLogger(__name__)

BATCH_SIZE = 5   # parallel Playwright pages
AI_BATCH = 50    # ingredient names per Gemini request
SCRAPE_TIMEOUT_S = 45
ALIAS_CONFIDENCE_THRESHOLD = 0.75

_VALID_MEAL_TYPES = {"entree", "plat", "dessert", "snack"}
_CANONICAL_JUNK_RE = __import__("re").compile(r"[®©™\[\](){}\"'<>\\|@#$%^&*+=;:!?]")


def _sanitize_ingredient_name(name: str) -> str:
    """Strip junk chars Gemini may hallucinate, normalize to lowercase underscored form."""
    import re
    name = _CANONICAL_JUNK_RE.sub("", (name or "")).strip().lower()
    name = re.sub(r"\s+", "_", name)
    name = re.sub(r"_+", "_", name).strip("_")
    return name


@celery_app.task(bind=True, name="import_marmiton.run")
def run_marmiton_import(self, job_id: int, urls: list[str]):
    asyncio.run(_run(job_id, urls))


async def _run(job_id: int, urls: list[str]):
    from playwright.async_api import async_playwright
    from sqlalchemy import select
    from app.database import AsyncSessionLocal, init_db
    from app.models.job import ImportJob
    from app.models.recipe import Recipe
    from app.ai.standardizer import standardize_batch
    from app.scrapers.marmiton import scrape_recipe
    from app.websocket.manager import manager

    await init_db()

    # Pre-filter URLs already processed (any status including error)
    async with AsyncSessionLocal() as db:
        done_urls = set(
            (await db.execute(select(Recipe.marmiton_url))).scalars().all()
        )
    urls = [u for u in urls if u not in done_urls]

    async with AsyncSessionLocal() as db:
        job = await db.get(ImportJob, job_id)
        if not job:
            return
        job.status = "running"
        job.started_at = utcnow()
        job.progress_total = len(urls)
        job.progress_current = 0
        await db.commit()

    await manager.broadcast(str(job_id), {
        "job_id": job_id,
        "current": 0,
        "total": len(urls),
        "processed": 0,
        "errors": 0,
        "status": "running",
    })

    from playwright_stealth import Stealth
    stealth = Stealth()

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=settings.PLAYWRIGHT_HEADLESS)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        )
        await stealth.apply_stealth_async(context)
        await context.route(
            "**/*.{png,jpg,jpeg,gif,webp,woff,woff2,ttf,otf,css,svg}",
            lambda r: r.abort(),
        )

        pages = [await context.new_page() for _ in range(BATCH_SIZE)]

        errors: list[str] = []
        processed = 0
        done = 0
        cancelled = False
        new_ingredient_ids: set[int] = set()
        all_new_recipe_ids: list[int] = []

        async def _scrape_one(url: str, page):
            """Scrape with 3 retries before giving up."""
            for attempt in range(3):
                try:
                    data = await scrape_recipe(url, page)
                    return url, data, None
                except Exception as e:
                    if attempt < 2:
                        await asyncio.sleep(3 * (attempt + 1))
                    else:
                        return url, None, str(e)

        for i in range(0, len(urls), BATCH_SIZE):
            # Cooperative cancellation check
            async with AsyncSessionLocal() as db:
                job = await db.get(ImportJob, job_id)
                if job and job.cancel_requested:
                    cancelled = True
                    break

            batch_urls = urls[i: i + BATCH_SIZE]
            tasks = [asyncio.create_task(_scrape_one(url, pages[j]))
                     for j, url in enumerate(batch_urls)]

            scraped: list[dict] = []
            failed_urls: list[tuple[str, str]] = []  # (url, error)

            for coro in asyncio.as_completed(tasks):
                url, data, err = await coro
                done += 1
                if isinstance(data, dict) and data.get("title"):
                    scraped.append(data)
                else:
                    failed_urls.append((url, err or "no title"))
                    errors.append(f"SKIP: {url} ({err or 'no title'})")

                await manager.broadcast(str(job_id), {
                    "job_id": job_id,
                    "current": done,
                    "total": len(urls),
                    "processed": processed + len(scraped),
                    "errors": len(errors),
                    "current_item": url,
                    "eta_seconds": _eta(done, len(urls)),
                })

            # Persist failed URLs as status="error" so they're skipped on future runs
            for fail_url, fail_err in failed_urls:
                try:
                    async with AsyncSessionLocal() as db:
                        exists = (await db.execute(
                            select(Recipe).where(Recipe.marmiton_url == fail_url)
                        )).scalar_one_or_none()
                        if not exists:
                            db.add(Recipe(
                                marmiton_url=fail_url,
                                title=None,
                                slug=None,
                                status="error",
                                error_message=fail_err[:500],
                                scraped_at=utcnow(),
                            ))
                            await db.commit()
                except Exception:
                    pass

            if scraped:
                # Batch standardize ingredient names
                all_raw_names = []
                name_map: list[tuple[int, int]] = []
                for ri, recipe_data in enumerate(scraped):
                    for ii, ing in enumerate(recipe_data.get("ingredients", [])):
                        all_raw_names.append(ing["name_raw"])
                        name_map.append((ri, ii))

                std_results = []
                for chunk_start in range(0, len(all_raw_names), AI_BATCH):
                    chunk = all_raw_names[chunk_start: chunk_start + AI_BATCH]
                    std_results.extend(await standardize_batch(chunk))

                for (ri, ii), res in zip(name_map, std_results):
                    scraped[ri]["ingredients"][ii]["canonical_name"] = res.canonical
                    scraped[ri]["ingredients"][ii]["variant_name"] = res.variant

                # Persist each recipe (isolated transactions)
                batch_recipe_ids: list[int] = []
                for recipe_data in scraped:
                    try:
                        async with AsyncSessionLocal() as db:
                            new_ids, recipe_id = await _persist_recipe(db, recipe_data)
                            await db.commit()
                            new_ingredient_ids.update(new_ids)
                            if recipe_id:
                                batch_recipe_ids.append(recipe_id)
                        processed += 1
                    except Exception as e:
                        errors.append(f"DB: {recipe_data.get('url', '?')} ({e})")
                        logger.error(f"Persist failed for {recipe_data.get('url')}: {e}")

                all_new_recipe_ids.extend(batch_recipe_ids)

            # Update job row after batch
            async with AsyncSessionLocal() as db:
                job = await db.get(ImportJob, job_id)
                if job:
                    job.progress_current = done
                    job.current_item = batch_urls[-1] if batch_urls else None
                    await db.commit()

        # --- Phase 2: generate aliases + deduplicate + price new ingredients ---
        if not cancelled and new_ingredient_ids:
            await manager.broadcast(str(job_id), {
                "job_id": job_id,
                "status": "pricing",
                "message": f"Recherche prix Maxi pour {len(new_ingredient_ids)} ingrédients…",
            })

            # Generate search aliases for all new ingredients
            await _generate_aliases_for_ingredients(sorted(new_ingredient_ids))

            # Deduplicate new ingredients vs existing
            await _deduplicate_ingredients(sorted(new_ingredient_ids))

            # Narrow to canonical parents only — variants inherit their
            # parent's StoreProduct through the hierarchy, so scraping them
            # individually wastes Maxi requests and rarely matches cleanly.
            to_price = await _canonical_parents_only(sorted(new_ingredient_ids))

            # Scrape Maxi synchronously (inline, same Celery job)
            priced_ids, unpriced_ids = await _price_new_ingredients(
                to_price, pages
            )

            # Gate recipes: mark complete/incomplete based on price coverage
            quarantine_lines = await _gate_recipes(all_new_recipe_ids, unpriced_ids)
            if quarantine_lines:
                errors.extend(quarantine_lines)

        await browser.close()

    final_status = "cancelled" if cancelled else "completed"

    async with AsyncSessionLocal() as db:
        job = await db.get(ImportJob, job_id)
        if job:
            job.status = final_status
            job.finished_at = utcnow()
            job.progress_current = done
            job.error_log = json.dumps(errors)
            await db.commit()

    await manager.broadcast(str(job_id), {
        "job_id": job_id,
        "status": final_status,
        "processed": processed,
        "current": done,
        "total": len(urls),
        "errors": len(errors),
    })

    # Maxi-only pipeline — no auto-cascade needed


async def _canonical_parents_only(ingredient_ids: list[int]) -> list[int]:
    """Filter a set of ingredient ids down to canonical parents (parent_id IS NULL).

    Variants (rows where parent_id is set) inherit their parent's
    StoreProduct through the hierarchy — scraping them wastes Maxi
    requests. Invalid rows (non-ingredients) are dropped here too.
    """
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models.ingredient import IngredientMaster

    if not ingredient_ids:
        return []
    async with AsyncSessionLocal() as db:
        q = select(IngredientMaster.id).where(
            IngredientMaster.id.in_(ingredient_ids),
            IngredientMaster.parent_id.is_(None),
            IngredientMaster.price_mapping_status != "invalid",
        )
        return [r[0] for r in (await db.execute(q)).all()]


async def _generate_aliases_for_ingredients(ingredient_ids: list[int]):
    """Fetch canonical names for new ingredients and generate search aliases via Gemini."""
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models.ingredient import IngredientMaster
    from app.ai.standardizer import generate_search_aliases

    async with AsyncSessionLocal() as db:
        ings = list((await db.execute(
            select(IngredientMaster).where(IngredientMaster.id.in_(ingredient_ids))
        )).scalars().all())

    # Only generate for ingredients that don't have aliases yet
    needs_aliases = [ing for ing in ings if not ing.search_aliases]
    if not needs_aliases:
        return

    names = [ing.canonical_name for ing in needs_aliases]
    aliases_map = await generate_search_aliases(names)

    async with AsyncSessionLocal() as db:
        for ing in needs_aliases:
            ing_db = await db.get(IngredientMaster, ing.id)
            if ing_db:
                ing_db.search_aliases = aliases_map.get(ing.canonical_name, [])
        await db.commit()

    logger.info(f"Generated aliases for {len(needs_aliases)} ingredients")


async def _price_new_ingredients(
    ingredient_ids: list[int],
    pages,
) -> tuple[set[int], set[int]]:
    """Scrape Maxi for each new ingredient using multi-query + AI validation.
    Returns (priced_ids, unpriced_ids).
    """
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models.ingredient import IngredientMaster
    from app.models.store import Store, StoreProduct, PriceHistory
    from app.scrapers.maxi import search_maxi
    from app.ai.classifier import validate_store_matches

    scrapers = {"maxi": search_maxi}
    priced_ids: set[int] = set()
    unpriced_ids: set[int] = set(ingredient_ids)

    async with AsyncSessionLocal() as db:
        stores_q = select(Store).where(Store.code.in_(["maxi"]))
        stores = {s.code: s for s in (await db.execute(stores_q)).scalars().all()}
        ings = list((await db.execute(
            select(IngredientMaster).where(IngredientMaster.id.in_(ingredient_ids))
        )).scalars().all())

    if not ings or not stores:
        return priced_ids, unpriced_ids

    async def _try_queries(page, scraper_fn, queries: list[str], store_id_param: str):
        """Try each query in order, return first successful result or None."""
        for query in queries:
            try:
                result = await asyncio.wait_for(
                    scraper_fn(page, query, store_id_param),
                    timeout=SCRAPE_TIMEOUT_S,
                )
                if result and not isinstance(result, Exception):
                    return result, query
            except (asyncio.TimeoutError, Exception) as e:
                logger.debug(f"Query '{query}' failed: {e}")
        return None, None

    for chunk_start in range(0, len(ings), BATCH_SIZE):
        chunk = ings[chunk_start: chunk_start + BATCH_SIZE]

        for code, store in stores.items():
            scraper_fn = scrapers[code]
            store_id_param = store.store_location_id or ""

            # Build query lists per ingredient (display_name + aliases)
            query_lists = []
            for ing in chunk:
                queries = []
                if ing.display_name_fr:
                    queries.append(ing.display_name_fr)
                aliases = ing.search_aliases or []
                for a in aliases:
                    if a not in queries:
                        queries.append(a)
                if not queries:
                    queries.append(ing.canonical_name.replace("_", " "))
                query_lists.append(queries)

            tasks = [
                asyncio.create_task(
                    _try_queries(pages[j], scraper_fn, query_lists[j], store_id_param)
                )
                for j, _ in enumerate(chunk)
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # AI batch-validate all found matches at once
            validation_pairs: list[tuple[int, dict, str]] = []  # (chunk_idx, result, matched_query)
            for idx, (ing, res) in enumerate(zip(chunk, results)):
                if isinstance(res, Exception) or not res or not res[0]:
                    continue
                result_dict, matched_query = res
                validation_pairs.append((idx, result_dict, matched_query))

            if validation_pairs:
                pairs_for_ai = [
                    (ing.canonical_name, validation_pairs[i][1].get("product_name", ""))
                    for i, (idx, _, _) in enumerate(validation_pairs)
                    for ing in [chunk[idx]]
                ]
                scores = await validate_store_matches(pairs_for_ai)

                async with AsyncSessionLocal() as db:
                    for (idx, result_dict, matched_query), score in zip(validation_pairs, scores):
                        ing = chunk[idx]
                        if score < ALIAS_CONFIDENCE_THRESHOLD:
                            logger.info(
                                f"{code}:{ing.canonical_name}: match '{result_dict.get('product_name')}' "
                                f"rejected (score={score:.2f})"
                            )
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

                        ing_db.price_mapping_status = "mapped"
                        ing_db.last_price_mapping_at = utcnow()
                        ing_db.price_map_attempts = (ing_db.price_map_attempts or 0) + 1

                        # #7: Update display_name_fr from real product name if still mechanical
                        await _maybe_update_display_name(ing_db, result_dict.get("product_name", ""))

                        priced_ids.add(ing.id)
                        unpriced_ids.discard(ing.id)

                        logger.info(
                            f"{code}:{ing.canonical_name} → '{result_dict.get('product_name')}' "
                            f"(score={score:.2f}, query='{matched_query}')"
                        )
                    await db.commit()

            # Increment attempt counter for misses
            missed = [ing for idx, ing in enumerate(chunk) if ing.id in unpriced_ids]
            if missed:
                async with AsyncSessionLocal() as db:
                    for ing in missed:
                        ing_db = await db.get(IngredientMaster, ing.id)
                        if ing_db:
                            ing_db.price_map_attempts = (ing_db.price_map_attempts or 0) + 1
                    await db.commit()

    # Mark permanently failed ingredients
    still_unpriced = list(unpriced_ids)
    if still_unpriced:
        async with AsyncSessionLocal() as db:
            for iid in still_unpriced:
                ing_db = await db.get(IngredientMaster, iid)
                if ing_db and (ing_db.price_map_attempts or 0) >= 5:
                    ing_db.price_mapping_status = "failed"
            await db.commit()

    logger.info(
        f"Pricing done: {len(priced_ids)} priced, {len(unpriced_ids)} unpriced "
        f"out of {len(ingredient_ids)} total"
    )
    return priced_ids, unpriced_ids


async def _maybe_update_display_name(ing_db, product_name: str):
    """Update display_name_fr from the real store product name if still mechanical."""
    if not product_name:
        return
    mechanical = ing_db.canonical_name.replace("_", " ").title()
    if ing_db.display_name_fr == mechanical:
        # Extract clean name: take first 2-3 words, strip brand/format indicators
        import re
        clean = re.split(r"\s+\d|\s+\(|\s+extra|\s+vierge|\s+maigre|\s+kg|\s+g\b|\s+ml\b", product_name, flags=re.I)[0]
        clean = clean.strip().rstrip(",.-")
        if len(clean) >= 3:
            ing_db.display_name_fr = clean.title()


async def _gate_recipes(recipe_ids: list[int], unpriced_ingredient_ids: set[int]) -> list[str]:
    """Mark recipes complete or incomplete based on price coverage.
    Returns quarantine summary lines for error_log.
    """
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.database import AsyncSessionLocal
    from app.models.recipe import Recipe, RecipeIngredient
    from app.models.ingredient import IngredientMaster

    if not recipe_ids:
        return []

    quarantine_lines: list[str] = []
    complete_count = 0

    async with AsyncSessionLocal() as db:
        recipes = list((await db.execute(
            select(Recipe)
            .options(selectinload(Recipe.ingredients).selectinload(RecipeIngredient.ingredient))
            .where(Recipe.id.in_(recipe_ids))
        )).scalars().all())

        for recipe in recipes:
            missing: list[str] = []
            for ri in recipe.ingredients:
                if not ri.ingredient_master_id:
                    continue
                # Check parent too (variants roll up to parent)
                master = ri.ingredient
                check_id = (master.parent_id if master and master.parent_id else ri.ingredient_master_id)
                if check_id in unpriced_ingredient_ids:
                    name = master.canonical_name if master else str(ri.ingredient_master_id)
                    if name not in missing:
                        missing.append(name)

            if missing:
                recipe.pricing_status = "incomplete"
                recipe.missing_price_ingredients = missing
                quarantine_lines.append(
                    f"QUARANTINE: '{recipe.title}' ({', '.join(missing[:3])}{'...' if len(missing) > 3 else ''})"
                )
                logger.warning(f"Recipe '{recipe.title}' quarantined — missing: {missing}")
            else:
                recipe.pricing_status = "complete"
                complete_count += 1

        await db.commit()

    if quarantine_lines:
        logger.info(
            f"Gate: {complete_count} recettes complètes, {len(quarantine_lines)} en quarantaine"
        )
    return quarantine_lines


async def _deduplicate_ingredients(ingredient_ids: list[int]):
    """Detect and merge duplicate IngredientMaster rows among new + nearby existing ones."""
    from app.services.ingredient_dedup import find_and_merge_duplicates
    from app.database import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as db:
            merged = await find_and_merge_duplicates(db, ingredient_ids)
            if merged:
                logger.info(f"Deduplication: merged {merged} ingredient pairs")
    except Exception as e:
        logger.warning(f"Deduplication failed (non-fatal): {e}")


async def _persist_recipe(db, data: dict) -> tuple[set[int], int | None]:
    """Persist one recipe + its ingredients.
    Returns (new_ingredient_ids, recipe_id).
    """
    from app.models.recipe import Recipe, RecipeIngredient
    from app.models.ingredient import IngredientMaster
    from app.ai.classifier import classify_recipe
    from sqlalchemy import select
    import json as _json

    new_ids: set[int] = set()

    existing = (await db.execute(select(Recipe).where(Recipe.marmiton_url == data["url"]))).scalar_one_or_none()
    if existing:
        return new_ids, None

    ingredients_text = ", ".join(
        ing.get("canonical_name") or ing.get("name_raw", "")
        for ing in data.get("ingredients", [])
        if ing.get("canonical_name") or ing.get("name_raw")
    )
    cls = await classify_recipe(data["title"], ingredients_text)

    meal_type = cls.get("meal_type") if cls else None
    if meal_type not in _VALID_MEAL_TYPES:
        meal_type = None

    health_score = None
    if cls and cls.get("health_score") is not None:
        try:
            health_score = max(0.0, min(10.0, float(cls["health_score"])))
        except (TypeError, ValueError):
            pass

    marmiton_id = data.get("marmiton_id")
    base_slug = slugify(data["title"])
    slug = f"{base_slug}-{marmiton_id}" if marmiton_id else base_slug

    recipe = Recipe(
        marmiton_url=data["url"],
        marmiton_id=marmiton_id,
        title=data["title"],
        slug=slug,
        image_url=data.get("image_url"),
        instructions=data.get("instructions"),
        servings=1,
        prep_time_min=data.get("prep_time_min"),
        cook_time_min=data.get("cook_time_min"),
        status="ai_done" if cls else "scraped",
        pricing_status="pending",
        scraped_at=utcnow(),
        ai_processed_at=utcnow() if cls else None,
        meal_type=meal_type,
        is_sweet=bool(cls.get("is_sweet", False)) if cls else False,
        is_salty=bool(cls.get("is_salty", False)) if cls else False,
        is_spicy=bool(cls.get("is_spicy", False)) if cls else False,
        is_vegetarian=bool(cls.get("is_vegetarian", False)) if cls else False,
        is_vegan=bool(cls.get("is_vegan", False)) if cls else False,
        cuisine_type=cls.get("cuisine_type") if cls else None,
        tags_json=_json.dumps(cls.get("tags", []), ensure_ascii=False) if cls and cls.get("tags") else None,
        health_score=health_score,
    )
    db.add(recipe)
    await db.flush()

    for order_i, ing in enumerate(data.get("ingredients", [])):
        canonical = _sanitize_ingredient_name(ing.get("canonical_name", ""))
        if not canonical or len(canonical) < 2:
            continue

        ing_master = (
            await db.execute(select(IngredientMaster).where(IngredientMaster.canonical_name == canonical))
        ).scalar_one_or_none()
        if not ing_master:
            ing_master = IngredientMaster(
                canonical_name=canonical,
                display_name_fr=canonical.replace("_", " ").title(),
            )
            db.add(ing_master)
            await db.flush()
            new_ids.add(ing_master.id)

        raw_variant = ing.get("variant_name")
        variant_name = _sanitize_ingredient_name(raw_variant) if raw_variant else None
        if variant_name and len(variant_name) >= 2 and variant_name != canonical:
            variant_master = (
                await db.execute(select(IngredientMaster).where(IngredientMaster.canonical_name == variant_name))
            ).scalar_one_or_none()
            if not variant_master:
                variant_master = IngredientMaster(
                    canonical_name=variant_name,
                    display_name_fr=variant_name.replace("_", " ").title(),
                    parent_id=ing_master.id,
                )
                db.add(variant_master)
                await db.flush()
                new_ids.add(variant_master.id)
            elif variant_master.parent_id is None:
                variant_master.parent_id = ing_master.id
            ing_master = variant_master

        ri = RecipeIngredient(
            recipe_id=recipe.id,
            ingredient_master_id=ing_master.id,
            raw_text=ing.get("raw_text"),
            quantity_per_portion=ing.get("quantity_per_portion"),
            unit=ing.get("unit", "unite"),
            order_index=order_i,
        )
        db.add(ri)

    return new_ids, recipe.id


def _eta(done: int, total: int) -> int:
    if done <= 0:
        return 0
    return total - done
