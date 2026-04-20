"""
Batch cooking generator:
  - Picks 3 diverse recipes (different meal_type / categories)
  - Distributes target_portions as [ceil, ceil, floor]  (e.g. 20 → 7+7+6)
  - Builds the ShoppingListItem list for the batch
"""
import math
import random
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.recipe import Recipe, RecipeIngredient
from app.models.batch import Batch, BatchRecipe, ShoppingListItem
from app.models.store import StoreProduct, Store
from app.models.inventory import InventoryItem
from app.services.unit_converter import get_scale_factor, to_base


async def generate_batch(
    db: AsyncSession,
    target_portions: int = 20,
    exclude_ids: list[int] | None = None,
    num_recipes: int = 3,
    meal_type_sequence: list[str] | None = None,
    vegetarian_only: bool = False,
    vegan_only: bool = False,
    max_cost_per_portion: float | None = None,
    prep_time_max_min: int | None = None,
    health_score_min: float | None = None,
    include_recipe_ids: list[int] | None = None,
) -> Batch:
    exclude_ids = list(exclude_ids or [])
    include_recipe_ids = list(include_recipe_ids or [])
    num_recipes = max(1, min(5, num_recipes))

    def _apply_filters(stmt):
        stmt = stmt.where(Recipe.id.not_in(exclude_ids)) if exclude_ids else stmt
        if vegan_only:
            stmt = stmt.where(Recipe.is_vegan.is_(True))
        elif vegetarian_only:
            stmt = stmt.where(Recipe.is_vegetarian.is_(True))
        if max_cost_per_portion is not None:
            stmt = stmt.where(
                (Recipe.estimated_cost_per_portion.is_(None))
                | (Recipe.estimated_cost_per_portion <= max_cost_per_portion)
            )
        if prep_time_max_min is not None:
            stmt = stmt.where(
                (Recipe.prep_time_min.is_(None))
                | (Recipe.prep_time_min <= prep_time_max_min)
            )
        if health_score_min is not None:
            stmt = stmt.where(Recipe.health_score >= health_score_min)
        return stmt

    load_opts = selectinload(Recipe.ingredients).selectinload(RecipeIngredient.ingredient)

    # Forced recipes (always included if available, bypass filters)
    forced: list[Recipe] = []
    if include_recipe_ids:
        forced_q = (
            select(Recipe)
            .options(load_opts)
            .where(Recipe.id.in_(include_recipe_ids))
        )
        forced = list((await db.execute(forced_q)).scalars().all())
        exclude_ids.extend([r.id for r in forced])

    # Candidate pool with filters
    q = _apply_filters(
        select(Recipe)
        .options(load_opts)
        .where(Recipe.status == "ai_done")
    ).order_by((func.coalesce(Recipe.health_score, 0) + func.random() * 3).desc()).limit(50)
    candidates = list((await db.execute(q)).scalars().all())

    if len(candidates) + len(forced) < num_recipes:
        # Relax status filter
        q2 = _apply_filters(
            select(Recipe)
            .options(load_opts)
            .where(Recipe.status.in_(["scraped", "ai_done"]))
        ).order_by(func.random()).limit(50)
        candidates = list((await db.execute(q2)).scalars().all())

    if len(candidates) + len(forced) < num_recipes:
        raise ValueError(
            f"Pas assez de recettes (besoin {num_recipes}, dispo {len(candidates) + len(forced)}). "
            "Assouplis les filtres ou importe plus de recettes."
        )

    selected: list[Recipe] = list(forced)

    if meal_type_sequence:
        # Fill by meal_type order, fallback random when none match
        by_type: dict[str, list[Recipe]] = {}
        for c in candidates:
            by_type.setdefault(c.meal_type or "plat", []).append(c)
        used = {r.id for r in selected}
        for target_type in meal_type_sequence[: num_recipes - len(selected)]:
            pool = [c for c in by_type.get(target_type, []) if c.id not in used]
            if not pool:
                pool = [c for c in candidates if c.id not in used]
            if not pool:
                break
            pick = random.choice(pool)
            selected.append(pick)
            used.add(pick.id)
    else:
        used = {r.id for r in selected}
        used_types: set[str] = {r.meal_type or "plat" for r in selected}
        random.shuffle(candidates)
        for r in candidates:
            if r.id in used:
                continue
            mt = r.meal_type or "plat"
            if mt not in used_types or len(selected) < num_recipes:
                selected.append(r)
                used.add(r.id)
                used_types.add(mt)
            if len(selected) >= num_recipes:
                break

    # Fallback fill if still short
    if len(selected) < num_recipes:
        used = {r.id for r in selected}
        for r in candidates:
            if r.id not in used:
                selected.append(r)
                used.add(r.id)
            if len(selected) >= num_recipes:
                break

    selected = selected[:num_recipes]
    n = len(selected)

    # Portion split: e.g. 20 portions / 3 recipes → [7, 7, 6]
    base = target_portions // n
    remainder = target_portions % n
    portions_split = [base + (1 if i < remainder else 0) for i in range(n)]

    batch = Batch(
        target_portions=target_portions,
        total_portions=sum(portions_split),
        status="draft",
    )
    db.add(batch)
    await db.flush()

    for recipe, portions in zip(selected, portions_split):
        db.add(BatchRecipe(batch_id=batch.id, recipe_id=recipe.id, portions=portions))

    # Build shopping list
    shopping_items = await _build_shopping_list(db, batch.id, list(zip(selected, portions_split)))
    total_cost = sum(item.estimated_cost or 0 for item in shopping_items)
    batch.total_estimated_cost = round(total_cost, 2)

    await db.commit()

    # Reload with eager-loaded relationships so the response serializer
    # doesn't trigger lazy loads in async context (MissingGreenlet).
    q = (
        select(Batch)
        .options(
            selectinload(Batch.batch_recipes).selectinload(BatchRecipe.recipe),
            selectinload(Batch.shopping_items).selectinload(ShoppingListItem.ingredient),
            selectinload(Batch.shopping_items).selectinload(ShoppingListItem.store),
            selectinload(Batch.shopping_items).selectinload(ShoppingListItem.store_product),
        )
        .where(Batch.id == batch.id)
    )
    return (await db.execute(q)).scalar_one()


async def _build_shopping_list(
    db: AsyncSession,
    batch_id: int,
    recipe_portions: list[tuple[Recipe, int]],
) -> list[ShoppingListItem]:
    # Aggregate needs: {ingredient_master_id: {unit: total_qty}}
    needs: dict[int, dict[str, float]] = {}
    for recipe, portions in recipe_portions:
        for ri in recipe.ingredients:
            if not ri.ingredient_master_id or not ri.quantity_per_portion:
                continue
            uid = ri.ingredient_master_id
            unit = ri.unit or "unite"
            needs.setdefault(uid, {}).setdefault(unit, 0)
            needs[uid][unit] += ri.quantity_per_portion * portions

    # Deduct inventory (FIFO by purchase date)
    inventory_q = (
        select(InventoryItem)
        .where(InventoryItem.ingredient_master_id.in_(list(needs.keys())))
        .order_by(InventoryItem.purchased_at.asc().nullslast())
    )
    inventory_items = list((await db.execute(inventory_q)).scalars().all())
    inv_by_ingredient: dict[int, list[InventoryItem]] = {}
    for item in inventory_items:
        inv_by_ingredient.setdefault(item.ingredient_master_id, []).append(item)

    # Load best store products for each ingredient
    products_q = (
        select(StoreProduct)
        .where(
            StoreProduct.ingredient_master_id.in_(list(needs.keys())),
            StoreProduct.is_validated == True,  # noqa: E712
            StoreProduct.price.isnot(None),
        )
        .order_by(StoreProduct.ingredient_master_id, StoreProduct.price.asc())
    )
    all_products = list((await db.execute(products_q)).scalars().all())
    # Best product per ingredient (lowest price)
    best_product: dict[int, StoreProduct] = {}
    for p in all_products:
        if p.ingredient_master_id not in best_product:
            best_product[p.ingredient_master_id] = p

    items: list[ShoppingListItem] = []

    for ingredient_id, unit_map in needs.items():
        for unit, total_needed in unit_map.items():
            # Deduct inventory
            from_inv = 0.0
            for inv_item in inv_by_ingredient.get(ingredient_id, []):
                if inv_item.unit == unit and inv_item.quantity > 0:
                    take = min(inv_item.quantity, total_needed - from_inv)
                    from_inv += take

            qty_to_buy = max(0.0, total_needed - from_inv)

            # Find best product
            product = best_product.get(ingredient_id)
            store_id = product.store_id if product else None
            product_id = product.id if product else None
            estimated_cost = None
            packages = 1
            format_qty = None
            format_unit = None

            if product and product.price and product.format_qty and qty_to_buy > 0:
                scale = get_scale_factor(qty_to_buy, unit, product.format_qty, product.format_unit or unit)
                if scale > 0:
                    packages = math.ceil(scale)
                    estimated_cost = round(product.price * packages, 2)
                    format_qty = product.format_qty
                    format_unit = product.format_unit

            sli = ShoppingListItem(
                batch_id=batch_id,
                ingredient_master_id=ingredient_id,
                store_id=store_id,
                store_product_id=product_id,
                quantity_needed=round(qty_to_buy, 3),
                unit=unit,
                format_qty=format_qty,
                format_unit=format_unit,
                packages_to_buy=packages,
                estimated_cost=estimated_cost,
                from_inventory_qty=round(from_inv, 3),
            )
            db.add(sli)
            items.append(sli)

    return items
