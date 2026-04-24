"""Recipe cost recomputation.

Every ``Recipe.estimated_cost_per_portion`` was always NULL until this file
existed — the field was declared on the model but never written anywhere.
That broke the entire budget UI (filters by cost, "Budget malin" suggestions,
sort by price, etc.).

The computation walks each RecipeIngredient, finds its mapped StoreProduct
price, prorates by (quantity_per_portion / format_qty), and sums. It skips
ingredients without a price (the recipe's total becomes partial but better
than nothing — we flag it via pricing_status).

Call ``recompute_all_costs(db)`` after a bulk price-mapping run, or
``recompute_recipes(db, recipe_ids)`` for targeted updates.
"""
from __future__ import annotations
import logging
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.recipe import Recipe, RecipeIngredient
from app.models.ingredient import IngredientMaster
from app.models.store import StoreProduct

logger = logging.getLogger(__name__)


async def _price_map(db: AsyncSession) -> dict[int, tuple[float, str]]:
    """Return ``{ingredient_master_id -> (unit_price_per_base_unit, base_unit)}``.

    ``base_unit`` is one of ``"g"``, ``"ml"``, ``"unite"`` — the canonical
    base the caller must normalize the recipe quantity into before
    multiplying. Without this check, multiplying a $/kg price by a qty in
    "g" silently undercounts by 1000×.

    Resolves by (parent | self): if the recipe references ``beurre_demi_sel``
    but only ``beurre`` has a StoreProduct, we still get a price.
    """
    from app.services.unit_converter import normalize_unit, to_base

    q = (
        select(
            IngredientMaster.id,
            IngredientMaster.parent_id,
            StoreProduct.price,
            StoreProduct.format_qty,
            StoreProduct.format_unit,
        )
        .join(StoreProduct, StoreProduct.ingredient_master_id == IngredientMaster.id)
        .where(StoreProduct.is_validated == True)  # noqa: E712
        .where(StoreProduct.price.isnot(None))
        .where(StoreProduct.format_qty.isnot(None))
        .where(StoreProduct.format_qty > 0)
    )
    rows = (await db.execute(q)).all()

    direct: dict[int, tuple[float, str]] = {}
    for ing_id, _parent, price, fmt_qty, fmt_unit in rows:
        fmt_unit = fmt_unit or "unite"
        base_unit, _kind = normalize_unit(fmt_unit)
        # Express the whole pack in base units (e.g. 2 kg → 2000 g).
        fmt_in_base = to_base(float(fmt_qty), fmt_unit)
        if fmt_in_base <= 0:
            continue
        unit_price = float(price) / fmt_in_base
        direct.setdefault(ing_id, (unit_price, base_unit))

    # Fallback: variants inherit their parent's (price, base_unit).
    id_to_parent_q = select(IngredientMaster.id, IngredientMaster.parent_id)
    id_to_parent = dict((await db.execute(id_to_parent_q)).all())

    resolved: dict[int, tuple[float, str]] = dict(direct)
    for child_id, parent_id in id_to_parent.items():
        if child_id in resolved:
            continue
        if parent_id and parent_id in resolved:
            resolved[child_id] = resolved[parent_id]

    return resolved


async def _compute_one(
    recipe: Recipe, prices: dict[int, tuple[float, str]]
) -> tuple[float | None, str]:
    """Returns (cost_per_portion, pricing_status).

    Converts each RecipeIngredient.quantity_per_portion to the base unit
    of its price lookup BEFORE multiplying. Without this step, a recipe
    that says "0.25 kg flour" priced against a "$/g" store product would
    undercount by 1000×. Units that don't match (count vs mass) are
    silently skipped — better than a wrong number.
    """
    from app.services.unit_converter import normalize_unit, to_base

    if not recipe.ingredients:
        return None, "pending"

    total = 0.0
    priced_count = 0
    for ri in recipe.ingredients:
        if ri.ingredient_master_id is None:
            continue
        tup = prices.get(ri.ingredient_master_id)
        if tup is None or ri.quantity_per_portion is None:
            continue
        unit_price, price_base = tup
        ri_unit = ri.unit or "unite"
        ri_base, _ = normalize_unit(ri_unit)
        # Incompatible base (recipe says "g" but product sells "unite") →
        # we can't produce a meaningful cost. Skip this line so the recipe
        # ends up as incomplete rather than wildly wrong.
        if ri_base != price_base:
            continue
        qty_in_base = to_base(float(ri.quantity_per_portion), ri_unit)
        total += unit_price * qty_in_base
        priced_count += 1

    total_ings = sum(1 for ri in recipe.ingredients if ri.ingredient_master_id)
    if total_ings == 0:
        return None, "pending"
    if priced_count == 0:
        return None, "pending"
    if priced_count == total_ings:
        return round(total, 2), "complete"
    return round(total, 2), "incomplete"


async def recompute_recipes(
    db: AsyncSession, recipe_ids: Iterable[int] | None = None
) -> dict[str, int]:
    """Recompute estimated_cost_per_portion + pricing_status for each recipe.

    Pass ``recipe_ids=None`` to recompute the entire catalogue. Returns
    counters: {"updated": N, "complete": N, "incomplete": N, "pending": N}.
    """
    prices = await _price_map(db)
    logger.info("Recipe cost: loaded %d priced ingredients", len(prices))

    q = select(Recipe).options(selectinload(Recipe.ingredients))
    if recipe_ids is not None:
        ids = list(recipe_ids)
        if not ids:
            return {"updated": 0, "complete": 0, "incomplete": 0, "pending": 0}
        q = q.where(Recipe.id.in_(ids))

    recipes = list((await db.execute(q)).scalars().all())

    updated = 0
    status_counts = {"complete": 0, "incomplete": 0, "pending": 0}

    for r in recipes:
        cost, status = await _compute_one(r, prices)
        if r.estimated_cost_per_portion != cost or r.pricing_status != status:
            r.estimated_cost_per_portion = cost
            r.pricing_status = status
            updated += 1
        status_counts[status] += 1

    await db.commit()
    logger.info(
        "Recipe cost: processed %d recipes, updated %d (complete=%d incomplete=%d pending=%d)",
        len(recipes), updated, status_counts["complete"],
        status_counts["incomplete"], status_counts["pending"],
    )
    return {"updated": updated, **status_counts}


async def recompute_all_costs(db: AsyncSession) -> dict[str, int]:
    return await recompute_recipes(db, recipe_ids=None)
