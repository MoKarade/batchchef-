"""Personal statistics — item #36.

Surfaces usage patterns from the last N days:
  - How many batches created
  - Total portions cooked
  - Average cost per portion
  - Top 5 recipes by frequency (count across all batches)
  - Most-used ingredients (from RecipeIngredient × batches)
  - Trend sparkline of batches per week

One endpoint, one screen. Kept separate from /api/receipts/stats (which is
shopping-side analytics) to keep the shapes small and purpose-specific.
"""
from datetime import datetime, timedelta, date
from collections import Counter, defaultdict
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.batch import Batch, BatchRecipe
from app.models.recipe import Recipe
from app.utils.time import utcnow

router = APIRouter(prefix="/api/stats", tags=["stats"])


class TopRecipe(BaseModel):
    recipe_id: int
    title: str
    image_url: str | None = None
    times_used: int
    total_portions: int


class WeekBucket(BaseModel):
    week_start: date
    batches: int
    portions: int


class PersonalStats(BaseModel):
    window_days: int
    total_batches: int
    total_portions: int
    total_recipes_unique: int
    avg_portions_per_batch: float
    avg_cost_per_portion: float | None
    top_recipes: list[TopRecipe]
    weekly: list[WeekBucket]


@router.get("/personal", response_model=PersonalStats)
async def personal_stats(
    days: int = Query(90, ge=7, le=365),
    db: AsyncSession = Depends(get_db),
):
    cutoff = utcnow() - timedelta(days=days)

    # All batches in the window, with their batch_recipes eager-loaded
    q = (
        select(Batch)
        .where(Batch.generated_at >= cutoff)
        .options(selectinload(Batch.batch_recipes).selectinload(BatchRecipe.recipe))
    )
    batches = list((await db.execute(q)).scalars().all())

    total_batches = len(batches)
    total_portions = sum(b.total_portions or b.target_portions for b in batches)
    avg_portions = (
        round(total_portions / total_batches, 1) if total_batches else 0.0
    )

    # Cost
    priced_batches = [b for b in batches if b.total_estimated_cost]
    if priced_batches:
        total_cost = sum(b.total_estimated_cost or 0 for b in priced_batches)
        total_priced_portions = sum(
            b.total_portions or b.target_portions for b in priced_batches
        )
        avg_cost = (
            round(total_cost / total_priced_portions, 2)
            if total_priced_portions
            else None
        )
    else:
        avg_cost = None

    # Top recipes
    recipe_counter: Counter[int] = Counter()
    recipe_portions: defaultdict[int, int] = defaultdict(int)
    recipe_meta: dict[int, tuple[str, str | None]] = {}
    for b in batches:
        for br in b.batch_recipes:
            recipe_counter[br.recipe_id] += 1
            recipe_portions[br.recipe_id] += br.portions
            if br.recipe:
                recipe_meta[br.recipe_id] = (br.recipe.title, br.recipe.image_url)
    top5 = [
        TopRecipe(
            recipe_id=rid,
            title=recipe_meta.get(rid, (f"Recette #{rid}", None))[0],
            image_url=recipe_meta.get(rid, (None, None))[1],
            times_used=count,
            total_portions=recipe_portions[rid],
        )
        for rid, count in recipe_counter.most_common(5)
    ]

    total_recipes_unique = len(recipe_counter)

    # Weekly buckets (Monday-indexed)
    weekly_map: defaultdict[date, dict] = defaultdict(lambda: {"batches": 0, "portions": 0})
    for b in batches:
        day = b.generated_at.date()
        monday = day - timedelta(days=day.weekday())
        weekly_map[monday]["batches"] += 1
        weekly_map[monday]["portions"] += b.total_portions or b.target_portions
    weekly = [
        WeekBucket(week_start=wk, batches=v["batches"], portions=v["portions"])
        for wk, v in sorted(weekly_map.items())
    ]

    return PersonalStats(
        window_days=days,
        total_batches=total_batches,
        total_portions=total_portions,
        total_recipes_unique=total_recipes_unique,
        avg_portions_per_batch=avg_portions,
        avg_cost_per_portion=avg_cost,
        top_recipes=top5,
        weekly=weekly,
    )
