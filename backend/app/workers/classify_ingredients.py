"""Celery task: auto-categorize + fix corrupted canonical names in one pass.

Covers Improvement 1 (name cleanup) + Improvement 2 (10-category taxonomy)
in a single Gemini round-trip per batch.

Category taxonomy (10 + "autre"):
  fruit | legume | viande | poisson_fruits_de_mer | produit_laitier |
  cereales_feculents | epices_herbes | noix_graines |
  conserves_condiments | boissons | autre
"""
import asyncio
import json
import logging
import re

from app.workers.celery_app import celery_app
from app.utils.time import utcnow

logger = logging.getLogger(__name__)

BATCH = 30

CLASSIFY_SYSTEM = """Tu es un expert en ingrédients culinaires québécois.
Pour chaque ingrédient fourni, renvoie un JSON array (même ordre que l'input)
où chaque élément a ce format exact:
{
  "clean_name": "nom_canonique_nettoye",
  "display_fr": "Nom lisible en français",
  "category": "fruit|legume|viande|poisson_fruits_de_mer|produit_laitier|cereales_feculents|epices_herbes|noix_graines|conserves_condiments|boissons|autre",
  "subcategory": "précision courte (ex: 'agrumes', 'volaille', 'fromage')",
  "is_produce": true|false,
  "is_taxable": true|false,
  "default_unit": "g|ml|unite"
}

Règles:
- clean_name: lowercase, underscores entre mots, sans accents, sans préfixe bizarre
  ('ait_lait' → 'lait', 'alettes_bretonnes' → 'galettes_bretonnes',
  '3_tomates' → 'tomates'). Si tu n'es pas sûr, garde l'original.
- is_produce=true uniquement pour les FRUITS et LÉGUMES frais (pas congelés).
- is_taxable=true pour TOUS les produits sauf fruits/légumes/pain/lait/oeufs frais
  (règle Revenu Québec).
- default_unit: 'unite' pour œufs/fruits comptables, 'ml' pour liquides, 'g' sinon.
- Réponse = JSON pur, pas de markdown."""


@celery_app.task(bind=True, name="ingredients.classify")
def run_classify_ingredients(self, job_id: int, ingredient_ids: list[int] | None = None):
    asyncio.run(_run(job_id, ingredient_ids))


async def _run(job_id: int, ingredient_ids: list[int] | None):
    from sqlalchemy import select
    from app.database import AsyncSessionLocal, init_db
    from app.models.job import ImportJob
    from app.models.ingredient import IngredientMaster
    from app.ai.client import call_claude
    from app.ai.utils import parse_json_response

    await init_db()

    async with AsyncSessionLocal() as db:
        job = await db.get(ImportJob, job_id)
        if not job:
            return
        job.status = "running"
        job.started_at = utcnow()

        q = select(IngredientMaster)
        if ingredient_ids:
            q = q.where(IngredientMaster.id.in_(ingredient_ids))
        else:
            # Target ones that are un-categorized or have corrupted canonical (start with short prefix)
            q = q.where(
                (IngredientMaster.category.is_(None))
                | (IngredientMaster.canonical_name.op("~*")(r"^(ait|alettes|rasse|ra_se|raîche|pices|eurre|hamp)_"))
            )
        ingredients = list((await db.execute(q)).scalars().all())
        job.progress_total = len(ingredients)
        await db.commit()

    errors: list[str] = []
    done = 0

    for start in range(0, len(ingredients), BATCH):
        async with AsyncSessionLocal() as db:
            job = await db.get(ImportJob, job_id)
            if job and job.cancel_requested:
                break

        chunk = ingredients[start: start + BATCH]
        payload = [
            {"canonical": ing.canonical_name, "display": ing.display_name_fr}
            for ing in chunk
        ]
        user = f"Input: {json.dumps(payload, ensure_ascii=False)}"

        try:
            text = await call_claude(CLASSIFY_SYSTEM, user)
            parsed = parse_json_response(text)
            if not isinstance(parsed, list) or len(parsed) != len(chunk):
                raise ValueError(f"shape mismatch: got {type(parsed).__name__} len={len(parsed) if isinstance(parsed, list) else 0}")
        except Exception as e:
            errors.append(f"batch@{start}: {e}")
            logger.warning(f"classify batch failed: {e}")
            done += len(chunk)
            continue

        async with AsyncSessionLocal() as db:
            for ing, result in zip(chunk, parsed):
                fresh = await db.get(IngredientMaster, ing.id)
                if not fresh:
                    continue
                clean = (result.get("clean_name") or fresh.canonical_name).strip().lower()
                # Only rename if the cleaned name doesn't collide with another row
                if clean and clean != fresh.canonical_name:
                    dupe = (await db.execute(
                        select(IngredientMaster.id).where(
                            IngredientMaster.canonical_name == clean,
                            IngredientMaster.id != fresh.id,
                        )
                    )).first()
                    if not dupe:
                        fresh.canonical_name = clean
                if result.get("display_fr"):
                    fresh.display_name_fr = result["display_fr"]
                if result.get("category") in (
                    "fruit", "legume", "viande", "poisson_fruits_de_mer",
                    "produit_laitier", "cereales_feculents", "epices_herbes",
                    "noix_graines", "conserves_condiments", "boissons", "autre",
                ):
                    fresh.category = result["category"]
                if result.get("subcategory"):
                    fresh.subcategory = result["subcategory"]
                if "is_produce" in result:
                    fresh.is_produce = bool(result["is_produce"])
                if "is_taxable" in result:
                    fresh.is_taxable = bool(result["is_taxable"])
                if result.get("default_unit") in ("g", "ml", "unite"):
                    fresh.default_unit = result["default_unit"]
            await db.commit()

        done += len(chunk)
        async with AsyncSessionLocal() as db:
            job = await db.get(ImportJob, job_id)
            if job:
                job.progress_current = done
                await db.commit()

    async with AsyncSessionLocal() as db:
        job = await db.get(ImportJob, job_id)
        if job:
            job.status = "completed"
            job.finished_at = utcnow()
            job.error_log = json.dumps(errors[:50])
            await db.commit()
