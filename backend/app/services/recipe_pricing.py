"""
Compute estimated_cost_per_portion for recipes from current StoreProduct prices.
Reuses the same unit-conversion logic as batch_generator but at single-portion scale.
"""
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.recipe import Recipe, RecipeIngredient
from app.models.store import StoreProduct
from app.services.unit_converter import get_scale_factor


async def compute_recipe_cost(db: AsyncSession, recipe: Recipe) -> float | None:
    """Return estimated cost for 1 portion, or None if no prices are available."""
    needs: dict[int, dict[str, float]] = {}
    for ri in recipe.ingredients:
        if not ri.ingredient_master_id or not ri.quantity_per_portion:
            continue
        uid = (
            ri.ingredient.parent_id
            if ri.ingredient and ri.ingredient.parent_id
            else ri.ingredient_master_id
        )
        unit = ri.unit or "unite"
        needs.setdefault(uid, {}).setdefault(unit, 0.0)
        needs[uid][unit] += ri.quantity_per_portion

    if not needs:
        return None

    products_q = (
        select(StoreProduct)
        .where(
            StoreProduct.ingredient_master_id.in_(list(needs.keys())),
            StoreProduct.price.isnot(None),
            StoreProduct.format_qty.isnot(None),
        )
        .order_by(StoreProduct.ingredient_master_id, StoreProduct.price.asc())
    )
    all_products = list((await db.execute(products_q)).scalars().all())
    best: dict[int, StoreProduct] = {}
    for p in all_products:
        if p.ingredient_master_id not in best:
            best[p.ingredient_master_id] = p

    total = 0.0
    priced = 0
    for ingredient_id, unit_map in needs.items():
        product = best.get(ingredient_id)
        if not product:
            continue
        priced += 1
        for unit, qty in unit_map.items():
            scale = get_scale_factor(qty, unit, product.format_qty, product.format_unit or unit)
            if scale > 0:
                total += (product.price or 0) * scale

    return round(total, 4) if priced > 0 else None


async def recompute_recipe_costs(
    db: AsyncSession,
    recipe_ids: list[int] | None = None,
) -> dict[str, int]:
    """Recompute estimated_cost_per_portion for all (or given) recipes in-place.
    Returns {"updated": N, "missing": M}.
    """
    q = select(Recipe).options(
        selectinload(Recipe.ingredients).selectinload(RecipeIngredient.ingredient)
    )
    if recipe_ids:
        q = q.where(Recipe.id.in_(recipe_ids))

    recipes = list((await db.execute(q)).scalars().all())
    updated = 0
    missing = 0
    for recipe in recipes:
        cost = await compute_recipe_cost(db, recipe)
        if cost is not None:
            recipe.estimated_cost_per_portion = cost
            updated += 1
        else:
            missing += 1

    await db.commit()
    return {"updated": updated, "missing": missing}
