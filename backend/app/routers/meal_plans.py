"""Weekly meal plan routes — Trello-style week board.

Endpoints:
  GET    /api/meal-plans              list all plans (most recent first)
  GET    /api/meal-plans/current      current-week plan (creates if missing)
  GET    /api/meal-plans/{id}         single plan with entries + recipe briefs
  POST   /api/meal-plans              create a new plan
  DELETE /api/meal-plans/{id}         delete plan + entries (cascade)
  POST   /api/meal-plans/{id}/entries     add a recipe card
  PATCH  /api/meal-plans/{id}/entries/{entry_id}   drag-drop move + reorder
  DELETE /api/meal-plans/{id}/entries/{entry_id}   remove card
  POST   /api/meal-plans/{id}/to-batch     convert plan to a Batch (shopping list)

Design:
  week_start_date is always a Monday. ``get_current_week_monday()`` computes
  it from ``date.today()``. When a user opens /planifier we auto-create the
  current week so the board is never empty.
"""
from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_optional_user
from app.database import get_db
from app.models.meal_plan import MealPlan, PlannedMeal
from app.models.recipe import Recipe
from app.models.user import User
from app.schemas.meal_plan import (
    MealPlanOut,
    MealPlanCreate,
    PlannedMealCreate,
    PlannedMealMove,
)

router = APIRouter(prefix="/api/meal-plans", tags=["meal-plans"])


# ── helpers ──────────────────────────────────────────────────────────────────
def _monday_of(d: date) -> date:
    """Monday of the ISO week containing ``d``. Python's ``weekday()`` returns
    0 for Monday, so subtracting that many days always lands on Monday."""
    return d - timedelta(days=d.weekday())


_VALID_SLOTS = {"midi", "soir", "snack"}


def _validate_cell(day_of_week: int, meal_slot: str) -> None:
    if not (0 <= day_of_week <= 6):
        raise HTTPException(400, "day_of_week must be 0..6 (Mon..Sun)")
    if meal_slot not in _VALID_SLOTS:
        raise HTTPException(
            400, f"meal_slot must be one of {sorted(_VALID_SLOTS)}"
        )


async def _load_plan(db: AsyncSession, plan_id: int) -> MealPlan:
    q = (
        select(MealPlan)
        .where(MealPlan.id == plan_id)
        .options(selectinload(MealPlan.entries).selectinload(PlannedMeal.recipe))
    )
    plan = (await db.execute(q)).scalar_one_or_none()
    if not plan:
        raise HTTPException(404, "Plan not found")
    return plan


# ── routes ───────────────────────────────────────────────────────────────────
@router.get("", response_model=list[MealPlanOut])
async def list_plans(db: AsyncSession = Depends(get_db)):
    q = (
        select(MealPlan)
        .order_by(MealPlan.week_start_date.desc())
        .options(selectinload(MealPlan.entries).selectinload(PlannedMeal.recipe))
    )
    return (await db.execute(q)).scalars().all()


@router.get("/current", response_model=MealPlanOut)
async def get_current_week(
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """Return the plan for the current ISO week, creating an empty one if
    none exists yet. Opening /planifier should never show a 404.

    Scoped to the authenticated user (item #35). Unauthenticated requests
    fall back to the "shared" bucket (user_id NULL) so the app still works
    without login for dev / single-user deployments.
    """
    monday = _monday_of(date.today())
    uid = user.id if user else None
    q = (
        select(MealPlan)
        .where(
            MealPlan.week_start_date == monday,
            MealPlan.user_id.is_(None) if uid is None else MealPlan.user_id == uid,
        )
        .options(selectinload(MealPlan.entries).selectinload(PlannedMeal.recipe))
    )
    plan = (await db.execute(q)).scalar_one_or_none()
    if plan:
        return plan

    plan = MealPlan(week_start_date=monday, user_id=uid)
    db.add(plan)
    await db.commit()
    return await _load_plan(db, plan.id)


@router.post("", response_model=MealPlanOut, status_code=201)
async def create_plan(body: MealPlanCreate, db: AsyncSession = Depends(get_db)):
    monday = _monday_of(body.week_start_date or date.today())
    # Re-use an existing plan for that week if any — creation should be
    # idempotent by (user, week).
    existing = (
        await db.execute(select(MealPlan).where(MealPlan.week_start_date == monday))
    ).scalar_one_or_none()
    if existing:
        return await _load_plan(db, existing.id)

    plan = MealPlan(week_start_date=monday, name=body.name)
    db.add(plan)
    await db.commit()
    return await _load_plan(db, plan.id)


@router.get("/{plan_id}", response_model=MealPlanOut)
async def get_plan(plan_id: int, db: AsyncSession = Depends(get_db)):
    return await _load_plan(db, plan_id)


@router.delete("/{plan_id}", status_code=204)
async def delete_plan(plan_id: int, db: AsyncSession = Depends(get_db)):
    plan = await db.get(MealPlan, plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    await db.delete(plan)
    await db.commit()


@router.post("/{plan_id}/entries", response_model=MealPlanOut, status_code=201)
async def add_entry(
    plan_id: int, body: PlannedMealCreate, db: AsyncSession = Depends(get_db)
):
    _validate_cell(body.day_of_week, body.meal_slot)
    plan = await db.get(MealPlan, plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")

    recipe = await db.get(Recipe, body.recipe_id)
    if not recipe:
        raise HTTPException(404, f"Recipe {body.recipe_id} not found")

    # Append at the end of the target cell
    max_pos_q = select(PlannedMeal.position).where(
        PlannedMeal.meal_plan_id == plan_id,
        PlannedMeal.day_of_week == body.day_of_week,
        PlannedMeal.meal_slot == body.meal_slot,
    ).order_by(PlannedMeal.position.desc()).limit(1)
    current_max = (await db.execute(max_pos_q)).scalar_one_or_none()
    new_pos = (current_max + 1) if current_max is not None else 0

    entry = PlannedMeal(
        meal_plan_id=plan_id,
        recipe_id=body.recipe_id,
        day_of_week=body.day_of_week,
        meal_slot=body.meal_slot,
        position=new_pos,
        portions=body.portions,
        notes=body.notes,
    )
    db.add(entry)
    await db.commit()
    return await _load_plan(db, plan_id)


@router.patch(
    "/{plan_id}/entries/{entry_id}", response_model=MealPlanOut
)
async def move_entry(
    plan_id: int,
    entry_id: int,
    body: PlannedMealMove,
    db: AsyncSession = Depends(get_db),
):
    entry = await db.get(PlannedMeal, entry_id)
    if not entry or entry.meal_plan_id != plan_id:
        raise HTTPException(404, "Entry not found in this plan")

    if body.day_of_week is not None or body.meal_slot is not None:
        new_day = body.day_of_week if body.day_of_week is not None else entry.day_of_week
        new_slot = body.meal_slot if body.meal_slot is not None else entry.meal_slot
        _validate_cell(new_day, new_slot)
        entry.day_of_week = new_day
        entry.meal_slot = new_slot

    if body.position is not None:
        entry.position = body.position
    if body.portions is not None:
        entry.portions = body.portions
    if body.notes is not None:
        entry.notes = body.notes

    await db.commit()
    return await _load_plan(db, plan_id)


@router.delete("/{plan_id}/entries/{entry_id}", status_code=204)
async def delete_entry(
    plan_id: int, entry_id: int, db: AsyncSession = Depends(get_db)
):
    entry = await db.get(PlannedMeal, entry_id)
    if not entry or entry.meal_plan_id != plan_id:
        raise HTTPException(404, "Entry not found in this plan")
    await db.delete(entry)
    await db.commit()


@router.post("/{plan_id}/to-batch", status_code=201)
async def plan_to_batch(
    plan_id: int, db: AsyncSession = Depends(get_db)
):
    """Convert a week plan to a Batch. Picks every distinct recipe with its
    total portions across all cells, then runs the normal batch acceptance
    flow so the user gets a proper shopping list.

    Note: we intentionally do NOT delete the plan — the user keeps the
    calendar visible even after generating the batch.
    """
    from app.services.batch_generator import persist_batch_from_slots

    plan = await _load_plan(db, plan_id)
    if not plan.entries:
        raise HTTPException(400, "Plan has no recipes — nothing to batch.")

    # Aggregate portions by recipe_id
    totals: dict[int, int] = {}
    for e in plan.entries:
        totals[e.recipe_id] = totals.get(e.recipe_id, 0) + e.portions

    slots = [(rid, p) for rid, p in totals.items()]
    target_portions = sum(totals.values())
    name = plan.name or f"Semaine du {plan.week_start_date.isoformat()}"

    batch = await persist_batch_from_slots(
        db, target_portions=target_portions, slots=slots, name=name
    )
    return {"batch_id": batch.id}
