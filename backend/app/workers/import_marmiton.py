"""
Celery task: bulk Marmiton import pipeline.
For each URL:
  1. Scrape with Playwright
  2. AI standardize ingredient names (batched 50/req)
  3. AI classify recipe (meal_type, tags, health_score)
  4. Persist Recipe + RecipeIngredient in DB
  5. Broadcast progress via WebSocket manager
"""
import asyncio
import json
import logging
from datetime import datetime
from slugify import slugify

from app.workers.celery_app import celery_app
from app.config import settings

logger = logging.getLogger(__name__)

BATCH_SIZE = 5   # parallel Playwright pages
AI_BATCH = 50    # ingredient names per Gemini request


@celery_app.task(bind=True, name="import_marmiton.run")
def run_marmiton_import(self, job_id: int, urls: list[str]):
    asyncio.run(_run(job_id, urls))


async def _run(job_id: int, urls: list[str]):
    from playwright.async_api import async_playwright
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.database import AsyncSessionLocal, init_db
    from app.models.job import ImportJob
    from app.models.recipe import Recipe, RecipeIngredient
    from app.models.ingredient import IngredientMaster
    from app.ai.standardizer import standardize_batch
    from app.ai.classifier import classify_recipe
    from app.scrapers.marmiton import scrape_recipe
    from app.websocket.manager import manager

    await init_db()

    async with AsyncSessionLocal() as db:
        job = await db.get(ImportJob, job_id)
        if not job:
            return
        job.status = "running"
        job.started_at = datetime.utcnow()
        job.progress_total = len(urls)
        job.progress_current = 0
        await db.commit()

    # Emit initial progress so the UI leaves 0/? immediately
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
        # Block media/fonts to speed up scraping
        await context.route(
            "**/*.{png,jpg,jpeg,gif,webp,woff,woff2,ttf,otf,css,svg}",
            lambda r: r.abort(),
        )

        pages = [await context.new_page() for _ in range(BATCH_SIZE)]

        errors: list[str] = []
        processed = 0
        done = 0
        cancelled = False

        async def _scrape_one(url: str, page):
            try:
                data = await scrape_recipe(url, page)
                return url, data, None
            except Exception as e:
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
            for coro in asyncio.as_completed(tasks):
                url, data, err = await coro
                done += 1
                if isinstance(data, dict) and data.get("title"):
                    scraped.append(data)
                else:
                    errors.append(f"SKIP: {url} ({err or 'no title'})")

                # Emit progress per URL
                await manager.broadcast(str(job_id), {
                    "job_id": job_id,
                    "current": done,
                    "total": len(urls),
                    "processed": processed + len(scraped),
                    "errors": len(errors),
                    "current_item": url,
                    "eta_seconds": _eta(done, len(urls), processed + len(scraped)),
                })

            if scraped:
                # Collect all raw ingredient names from this mini-batch
                all_raw_names = []
                name_map: list[tuple[int, int]] = []  # (recipe_idx, ing_idx)
                for ri, recipe_data in enumerate(scraped):
                    for ii, ing in enumerate(recipe_data.get("ingredients", [])):
                        all_raw_names.append(ing["name_raw"])
                        name_map.append((ri, ii))

                # Batch standardize names (returns StandardizeResult with canonical + variant)
                std_results = []
                for chunk_start in range(0, len(all_raw_names), AI_BATCH):
                    chunk = all_raw_names[chunk_start: chunk_start + AI_BATCH]
                    std_results.extend(await standardize_batch(chunk))

                # Apply results back (canonical = Level 1, variant = Level 2 or None)
                for (ri, ii), res in zip(name_map, std_results):
                    scraped[ri]["ingredients"][ii]["canonical_name"] = res.canonical
                    scraped[ri]["ingredients"][ii]["variant_name"] = res.variant

                # Persist each recipe
                async with AsyncSessionLocal() as db:
                    for recipe_data in scraped:
                        await _persist_recipe(db, recipe_data)
                    await db.commit()

                processed += len(scraped)

            # Update job row after batch
            async with AsyncSessionLocal() as db:
                job = await db.get(ImportJob, job_id)
                if job:
                    job.progress_current = done
                    job.current_item = batch_urls[-1] if batch_urls else None
                    await db.commit()

        await browser.close()

    final_status = "cancelled" if cancelled else "completed"

    # Finalize job
    async with AsyncSessionLocal() as db:
        job = await db.get(ImportJob, job_id)
        if job:
            job.status = final_status
            job.finished_at = datetime.utcnow()
            job.progress_current = done
            job.error_log = json.dumps(errors[:100])  # keep last 100 errors
            await db.commit()

    await manager.broadcast(str(job_id), {
        "job_id": job_id,
        "status": final_status,
        "processed": processed,
        "current": done,
        "total": len(urls),
        "errors": len(errors),
    })


async def _persist_recipe(db, data: dict):
    from app.models.recipe import Recipe, RecipeIngredient
    from app.models.ingredient import IngredientMaster
    from app.ai.classifier import classify_recipe
    from sqlalchemy import select
    from slugify import slugify
    import json as _json

    # Check if URL already exists (idempotent)
    existing = (await db.execute(select(Recipe).where(Recipe.marmiton_url == data["url"]))).scalar_one_or_none()
    if existing:
        return

    # AI classification (health_score, meal_type, tags…)
    ingredients_text = ", ".join(
        ing.get("canonical_name") or ing.get("name_raw", "")
        for ing in data.get("ingredients", [])
        if ing.get("canonical_name") or ing.get("name_raw")
    )
    cls = await classify_recipe(data["title"], ingredients_text)

    recipe = Recipe(
        marmiton_url=data["url"],
        marmiton_id=data.get("marmiton_id"),
        title=data["title"],
        slug=slugify(data["title"]),
        image_url=data.get("image_url"),
        instructions=data.get("instructions"),
        servings=1,
        prep_time_min=data.get("prep_time_min"),
        cook_time_min=data.get("cook_time_min"),
        status="ai_done" if cls else "scraped",
        scraped_at=datetime.utcnow(),
        ai_processed_at=datetime.utcnow() if cls else None,
        meal_type=cls.get("meal_type"),
        is_sweet=bool(cls.get("is_sweet", False)),
        is_salty=bool(cls.get("is_salty", False)),
        is_spicy=bool(cls.get("is_spicy", False)),
        is_vegetarian=bool(cls.get("is_vegetarian", False)),
        is_vegan=bool(cls.get("is_vegan", False)),
        cuisine_type=cls.get("cuisine_type"),
        tags_json=_json.dumps(cls.get("tags", []), ensure_ascii=False) if cls.get("tags") else None,
        health_score=float(cls["health_score"]) if cls.get("health_score") is not None else None,
    )
    db.add(recipe)
    await db.flush()

    for order_i, ing in enumerate(data.get("ingredients", [])):
        canonical = ing.get("canonical_name", "").strip()
        if not canonical or len(canonical) < 2:
            continue

        # Level 1: generic ingredient master
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

        # Level 2: variant (e.g. "thon_en_boite" child of "thon")
        variant_name = ing.get("variant_name")
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
            elif variant_master.parent_id is None:
                # Back-fill parent link if missing
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


def _eta(done: int, total: int, processed_ok: int) -> int:
    """Rough ETA in seconds based on current speed (assumes 1s/url avg)."""
    if done <= 0:
        return 0
    remaining = total - done
    return remaining  # 1 second per URL approximation
