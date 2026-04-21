"""
Celery task: bulk Marmiton import pipeline.
For each URL:
  1. Pre-filter URLs already in DB (skip scraped/ai_done/error)
  2. Scrape with Playwright (3 retries per URL)
  3. AI standardize ingredient names (batched 50/req, 5 retries with backoff)
  4. AI classify recipe (5 retries with backoff)
  5. Persist Recipe + RecipeIngredient in DB (isolated per recipe)
  6. Broadcast progress via WebSocket manager
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

        errors: list[str] = []
        processed = 0
        done = 0
        cancelled = False
        new_ingredient_ids: set[int] = set()

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
                # Batch standardize ingredient names (with retry built into standardize_batch)
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

                # Persist each recipe in its own transaction (isolation)
                for recipe_data in scraped:
                    try:
                        async with AsyncSessionLocal() as db:
                            new_ids = await _persist_recipe(db, recipe_data)
                            await db.commit()
                            new_ingredient_ids.update(new_ids)
                        processed += 1
                    except Exception as e:
                        errors.append(f"DB: {recipe_data.get('url', '?')} ({e})")
                        logger.error(f"Persist failed for {recipe_data.get('url')}: {e}")

            # Update job row after batch
            async with AsyncSessionLocal() as db:
                job = await db.get(ImportJob, job_id)
                if job:
                    job.progress_current = done
                    job.current_item = batch_urls[-1] if batch_urls else None
                    await db.commit()

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

    # Auto-cascade: estimate Fruiterie prices + scrape Maxi/Costco for new ingredients
    if not cancelled and new_ingredient_ids:
        await _dispatch_price_jobs(job_id, sorted(new_ingredient_ids))


async def _dispatch_price_jobs(parent_job_id: int, ingredient_ids: list[int]):
    """Create + queue Fruiterie estimation and Maxi/Costco mapping sub-jobs."""
    from app.database import AsyncSessionLocal
    from app.models.job import ImportJob
    from app.workers.estimate_fruiterie_prices import run_estimate_fruiterie
    from app.workers.map_prices import run_price_mapping

    meta = json.dumps({"parent_job_id": parent_job_id, "ingredient_ids": ingredient_ids})

    async with AsyncSessionLocal() as db:
        fruit_job = ImportJob(
            job_type="fruiterie_estimate_auto",
            status="queued",
            progress_total=len(ingredient_ids),
            metadata_json=meta,
        )
        map_job = ImportJob(
            job_type="price_mapping_auto",
            status="queued",
            progress_total=len(ingredient_ids) * 2,  # 2 stores
            metadata_json=meta,
        )
        db.add(fruit_job)
        db.add(map_job)
        await db.commit()
        fruit_id = fruit_job.id
        map_id = map_job.id

    run_estimate_fruiterie.delay(fruit_id, ingredient_ids)
    run_price_mapping.delay(map_id, ["maxi", "costco"], ingredient_ids)
    logger.info(
        f"Auto-dispatched price jobs after import {parent_job_id}: "
        f"fruiterie={fruit_id}, mapping={map_id}, ingredients={len(ingredient_ids)}"
    )


async def _persist_recipe(db, data: dict) -> set[int]:
    """Persist one recipe + its ingredients. Returns the set of IngredientMaster
    IDs that were newly created during this call (so the caller can auto-trigger
    Fruiterie + Maxi/Costco price lookups on them).
    """
    from app.models.recipe import Recipe, RecipeIngredient
    from app.models.ingredient import IngredientMaster
    from app.ai.classifier import classify_recipe
    from sqlalchemy import select
    import json as _json

    new_ids: set[int] = set()

    existing = (await db.execute(select(Recipe).where(Recipe.marmiton_url == data["url"]))).scalar_one_or_none()
    if existing:
        return new_ids

    ingredients_text = ", ".join(
        ing.get("canonical_name") or ing.get("name_raw", "")
        for ing in data.get("ingredients", [])
        if ing.get("canonical_name") or ing.get("name_raw")
    )
    # classify_recipe now has its own retry logic
    cls = await classify_recipe(data["title"], ingredients_text)

    # Validate + sanitize classifier output
    meal_type = cls.get("meal_type") if cls else None
    if meal_type not in _VALID_MEAL_TYPES:
        meal_type = None

    health_score = None
    if cls and cls.get("health_score") is not None:
        try:
            health_score = max(0.0, min(10.0, float(cls["health_score"])))
        except (TypeError, ValueError):
            pass

    # Slug includes marmiton_id to guarantee uniqueness across same-title recipes
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
                # Promote orphan variant to correct parent
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

    return new_ids


def _eta(done: int, total: int) -> int:
    if done <= 0:
        return 0
    return total - done
