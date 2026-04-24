from __future__ import annotations
from datetime import date, datetime
from pydantic import BaseModel, ConfigDict
from app.schemas.recipe import RecipeBrief


class PlannedMealOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    recipe_id: int
    day_of_week: int
    meal_slot: str
    position: int
    portions: int
    notes: str | None = None
    recipe: RecipeBrief | None = None


class MealPlanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int | None = None
    week_start_date: date
    name: str | None = None
    notes: str | None = None
    created_at: datetime
    entries: list[PlannedMealOut] = []


class MealPlanCreate(BaseModel):
    """Create a new empty week plan. ``week_start_date`` defaults server-side
    to the Monday of the current ISO week when omitted."""
    week_start_date: date | None = None
    name: str | None = None


class PlannedMealCreate(BaseModel):
    recipe_id: int
    day_of_week: int       # 0..6
    meal_slot: str          # midi|soir|snack
    portions: int = 2
    notes: str | None = None


class PlannedMealMove(BaseModel):
    """Payload for drag-drop moves. Omitted fields keep their current value."""
    day_of_week: int | None = None
    meal_slot: str | None = None
    position: int | None = None
    portions: int | None = None
    notes: str | None = None
