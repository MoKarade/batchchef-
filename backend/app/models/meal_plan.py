"""Weekly meal plan — Trello-style board where each day is a column.

A ``MealPlan`` owns a week (Monday-indexed). ``PlannedMeal`` entries map a
recipe to a (day_of_week, meal_slot) cell so the frontend can render a
7×3 grid and allow drag-drop between cells.

Separate from ``Batch``: a Batch is a cooking session (shopping list +
portions to produce), a MealPlan is the CALENDAR. A user can convert
part/all of a plan into a batch via POST /api/meal-plans/{id}/to-batch
(creates a Batch from the week's recipes).
"""
from datetime import date, datetime
from sqlalchemy import Integer, String, Date, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class MealPlan(Base):
    __tablename__ = "meal_plan"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("user.id", ondelete="SET NULL"), index=True
    )
    # Monday of the ISO week this plan covers. Unique per user/week so a
    # user can't accidentally create two plans for the same week.
    week_start_date: Mapped[date] = mapped_column(Date, index=True)
    name: Mapped[str | None] = mapped_column(String)
    notes: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    entries: Mapped[list["PlannedMeal"]] = relationship(
        back_populates="meal_plan",
        cascade="all, delete-orphan",
        order_by="(PlannedMeal.day_of_week, PlannedMeal.meal_slot, PlannedMeal.position)",
    )


class PlannedMeal(Base):
    """One card on the Trello board.

    ``day_of_week``  0=Monday ... 6=Sunday (matches Python's .weekday())
    ``meal_slot``    "midi" | "soir" | "snack"  (same labels as the UI)
    ``position``     sort key within a (day, slot) cell, for drag-drop reorder
    """
    __tablename__ = "planned_meal"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    meal_plan_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("meal_plan.id", ondelete="CASCADE"), nullable=False, index=True
    )
    recipe_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("recipe.id", ondelete="CASCADE"), nullable=False
    )

    day_of_week: Mapped[int] = mapped_column(Integer, nullable=False)   # 0..6
    meal_slot: Mapped[str] = mapped_column(String, nullable=False)      # midi|soir|snack
    position: Mapped[int] = mapped_column(Integer, default=0)
    portions: Mapped[int] = mapped_column(Integer, default=2)
    notes: Mapped[str | None] = mapped_column(String)

    meal_plan: Mapped["MealPlan"] = relationship(back_populates="entries")
    recipe: Mapped["Recipe"] = relationship()  # noqa
