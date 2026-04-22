from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.recipe import Recipe, RecipeIngredient
from app.models.ingredient import IngredientMaster
from app.schemas.recipe import RecipeList, RecipeDetail
from app.schemas.job import JobOut

router = APIRouter(prefix="/api/recipes", tags=["recipes"])

SORT_MAP = {
    "id_desc": Recipe.id.desc(),
    "id_asc": Recipe.id.asc(),
    "health_desc": Recipe.health_score.desc().nulls_last(),
    "cost_asc": Recipe.estimated_cost_per_portion.asc().nulls_last(),
    "calories_asc": Recipe.calories_per_portion.asc().nulls_last(),
    "title_asc": Recipe.title.asc(),
}


@router.get("", response_model=RecipeList)
async def list_recipes(
    search: str | None = Query(None),
    meal_type: str | None = Query(None),
    tag: str | None = Query(None),
    status: str | None = Query(None),
    max_cost_per_portion: float | None = Query(None),
    prep_time_max_min: int | None = Query(None),
    health_score_min: float | None = Query(None),
    sort: Literal["id_desc", "id_asc", "health_desc", "cost_asc", "calories_asc", "title_asc"] = "id_desc",
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    q = select(Recipe)
    if search:
        q = q.where(Recipe.title.ilike(f"%{search}%"))
    if meal_type:
        q = q.where(Recipe.meal_type == meal_type)
    if status:
        q = q.where(Recipe.status == status)
    if tag == "vegetarian":
        q = q.where(Recipe.is_vegetarian == True)  # noqa: E712
    elif tag == "vegan":
        q = q.where(Recipe.is_vegan == True)  # noqa: E712
    if max_cost_per_portion is not None:
        q = q.where(
            (Recipe.estimated_cost_per_portion.is_(None))
            | (Recipe.estimated_cost_per_portion <= max_cost_per_portion)
        )
    if prep_time_max_min is not None:
        q = q.where(
            (Recipe.prep_time_min.is_(None))
            | (Recipe.prep_time_min <= prep_time_max_min)
        )
    if health_score_min is not None:
        q = q.where(Recipe.health_score >= health_score_min)

    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar_one()

    q = q.order_by(SORT_MAP[sort]).offset(offset).limit(limit)
    rows = (await db.execute(q)).scalars().all()

    return {"total": total, "offset": offset, "limit": limit, "items": rows}


@router.get("/{recipe_id}", response_model=RecipeDetail)
async def get_recipe(recipe_id: int, db: AsyncSession = Depends(get_db)):
    q = (
        select(Recipe)
        .options(
            selectinload(Recipe.ingredients).selectinload(RecipeIngredient.ingredient)
        )
        .where(Recipe.id == recipe_id)
    )
    recipe = (await db.execute(q)).scalar_one_or_none()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return recipe


class RecipeIngredientUpdate(BaseModel):
    ingredient_master_id: int | None = None
    quantity_per_portion: float | None = None
    unit: str | None = None
    note: str | None = None


@router.post("/classify-pending", response_model=JobOut, status_code=202)
async def classify_pending_recipes(
    recipe_ids: list[int] | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Retroactively run AI classification (health_score, meal_type, tags) on scraped recipes."""
    from app.models.job import ImportJob
    from app.workers.classify_recipes import run_classify_recipes

    job = ImportJob(job_type="classify_recipes", status="queued", progress_total=0, progress_current=0)
    db.add(job)
    await db.commit()
    await db.refresh(job)

    run_classify_recipes.delay(job.id, recipe_ids)
    return job


@router.post("/recompute-costs")
async def recompute_costs(
    recipe_ids: list[int] | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Recompute estimated_cost_per_portion for all (or given) recipes from current prices."""
    from app.services.recipe_pricing import recompute_recipe_costs
    return await recompute_recipe_costs(db, recipe_ids)


@router.patch("/{recipe_id}/ingredients/{ri_id}")
async def update_recipe_ingredient(
    recipe_id: int,
    ri_id: int,
    body: RecipeIngredientUpdate,
    db: AsyncSession = Depends(get_db),
):
    ri = await db.get(RecipeIngredient, ri_id)
    if not ri or ri.recipe_id != recipe_id:
        raise HTTPException(status_code=404, detail="Recipe ingredient not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(ri, k, v)
    await db.commit()
    return {"status": "ok", "id": ri.id}
