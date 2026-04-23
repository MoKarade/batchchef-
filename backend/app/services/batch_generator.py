"""
Batch cooking generator:
  - Picks N diverse recipes (different meal_type / categories)
  - Distributes target_portions as [ceil, ceil, floor]  (e.g. 20 → 7+7+6)
  - Builds the ShoppingListItem list for the batch

Public surface:
  - select_recipes(...)             — pure recipe selection (no DB writes)
  - compute_batch_preview(...)      — preview as dict, no persistence
  - persist_batch_from_slots(...)   — create Batch from explicit recipe slots
  - generate_batch(...)             — legacy: select + persist in one shot
"""
import math
import random
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.recipe import Recipe, RecipeIngredient
from app.models.batch import Batch, BatchRecipe, ShoppingListItem
from app.models.store import StoreProduct, Store
from app.models.ingredient import IngredientMaster
from app.models.inventory import InventoryItem
from app.services.unit_converter import get_scale_factor, convert_count_to_mass, normalize_unit


def _split_portions(target_portions: int, n: int) -> list[int]:
    base = target_portions // n
    remainder = target_portions % n
    return [base + (1 if i < remainder else 0) for i in range(n)]


async def select_recipes(
    db: AsyncSession,
    exclude_ids: list[int] | None = None,
    num_recipes: int = 3,
    meal_type_sequence: list[str] | None = None,
    vegetarian_only: bool = False,
    vegan_only: bool = False,
    max_cost_per_portion: float | None = None,
    prep_time_max_min: int | None = None,
    health_score_min: float | None = None,
    include_recipe_ids: list[int] | None = None,
) -> list[Recipe]:
    """Pure selection. Returns list of Recipe ORM objects with ingredients eager-loaded.
    No DB writes. Raises ValueError if not enough recipes match.
    """
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

    forced: list[Recipe] = []
    if include_recipe_ids:
        forced_q = (
            select(Recipe)
            .options(load_opts)
            .where(Recipe.id.in_(include_recipe_ids))
        )
        forced = list((await db.execute(forced_q)).scalars().all())
        exclude_ids.extend([r.id for r in forced])

    q = _apply_filters(
        select(Recipe)
        .options(load_opts)
        .where(Recipe.status == "ai_done")
        .where(Recipe.pricing_status == "complete")
    ).order_by((func.coalesce(Recipe.health_score, 0) + func.random() * 3).desc()).limit(50)
    candidates = list((await db.execute(q)).scalars().all())

    if len(candidates) + len(forced) < num_recipes:
        q2 = _apply_filters(
            select(Recipe)
            .options(load_opts)
            .where(Recipe.status.in_(["scraped", "ai_done"]))
            .where(Recipe.pricing_status == "complete")
        ).order_by(func.random()).limit(50)
        candidates = list((await db.execute(q2)).scalars().all())

    if len(candidates) + len(forced) < num_recipes:
        raise ValueError(
            f"Pas assez de recettes (besoin {num_recipes}, dispo {len(candidates) + len(forced)}). "
            "Assouplis les filtres ou importe plus de recettes."
        )

    selected: list[Recipe] = list(forced)

    if meal_type_sequence:
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

    if len(selected) < num_recipes:
        used = {r.id for r in selected}
        for r in candidates:
            if r.id not in used:
                selected.append(r)
                used.add(r.id)
            if len(selected) >= num_recipes:
                break

    return selected[:num_recipes]


async def _aggregate_needs(recipe_portions: list[tuple[Recipe, int]]) -> dict[int, dict[str, float]]:
    """Aggregate recipe ingredients into needs by ingredient_master_id and unit.

    Variants (e.g. 'beurre_fondu') roll up to their parent (e.g. 'beurre').
    Invalid rows (water, "au goût", fragments) are dropped — they're not
    real groceries and would only inflate the shopping list with unpriced
    entries.
    """
    needs: dict[int, dict[str, float]] = {}
    for recipe, portions in recipe_portions:
        for ri in recipe.ingredients:
            if not ri.ingredient_master_id or not ri.quantity_per_portion:
                continue
            if ri.ingredient and ri.ingredient.price_mapping_status == "invalid":
                continue
            uid = (
                ri.ingredient.parent_id
                if ri.ingredient and ri.ingredient.parent_id
                else ri.ingredient_master_id
            )
            unit = ri.unit or "unite"
            needs.setdefault(uid, {}).setdefault(unit, 0)
            needs[uid][unit] += ri.quantity_per_portion * portions
    return needs


async def _resolve_inventory_and_products(
    db: AsyncSession, ingredient_ids: list[int]
) -> tuple[dict[int, list[InventoryItem]], dict[int, StoreProduct]]:
    inventory_q = (
        select(InventoryItem)
        .where(InventoryItem.ingredient_master_id.in_(ingredient_ids))
        .order_by(InventoryItem.purchased_at.asc().nullslast())
    )
    inventory_items = list((await db.execute(inventory_q)).scalars().all())
    inv_by_ingredient: dict[int, list[InventoryItem]] = {}
    for item in inventory_items:
        inv_by_ingredient.setdefault(item.ingredient_master_id, []).append(item)

    products_q = (
        select(StoreProduct)
        .where(
            StoreProduct.ingredient_master_id.in_(ingredient_ids),
            StoreProduct.price.isnot(None),
        )
        .order_by(
            StoreProduct.ingredient_master_id,
            StoreProduct.is_validated.desc(),  # validated scrapers first
            StoreProduct.price.asc(),
        )
    )
    all_products = list((await db.execute(products_q)).scalars().all())
    best_product: dict[int, StoreProduct] = {}
    for p in all_products:
        if p.ingredient_master_id not in best_product:
            best_product[p.ingredient_master_id] = p
    return inv_by_ingredient, best_product


def _compute_shopping_row(
    ingredient_id: int,
    unit: str,
    total_needed: float,
    inv_items: list[InventoryItem],
    product: StoreProduct | None,
    canonical_name: str | None = None,
) -> dict:
    from_inv = 0.0
    for inv_item in inv_items:
        if inv_item.unit == unit and inv_item.quantity > 0:
            take = min(inv_item.quantity, total_needed - from_inv)
            from_inv += take

    qty_to_buy = max(0.0, total_needed - from_inv)
    estimated_cost: float | None = None
    packages = 1
    format_qty: float | None = None
    format_unit: str | None = None
    effective_qty = qty_to_buy
    effective_unit = unit

    if product and product.price and product.format_qty and qty_to_buy > 0:
        scale = get_scale_factor(qty_to_buy, unit, product.format_qty, product.format_unit or unit)
        # Fallback: recipe uses count ("12 abricots") but store sells by mass ("200 g").
        # Convert count → grams using an average weight table so we don't end up
        # computing "48 abricots" where the user expected ~200 g of apricots.
        if scale == 0 and canonical_name:
            _, need_type = normalize_unit(unit)
            _, fmt_type = normalize_unit(product.format_unit or "unite")
            if need_type == "count" and fmt_type == "mass":
                mass_g = convert_count_to_mass(canonical_name, qty_to_buy)
                if mass_g is not None:
                    scale = get_scale_factor(mass_g, "g", product.format_qty, product.format_unit or "g")
                    if scale > 0:
                        effective_qty = round(mass_g, 0)
                        effective_unit = "g"
        if scale > 0:
            packages = math.ceil(scale)
            estimated_cost = round(product.price * packages, 2)
            format_qty = product.format_qty
            format_unit = product.format_unit

    return {
        "ingredient_master_id": ingredient_id,
        "store_id": product.store_id if product else None,
        "store_product_id": product.id if product else None,
        "quantity_needed": round(effective_qty, 3),
        "unit": effective_unit,
        "format_qty": format_qty,
        "format_unit": format_unit,
        "packages_to_buy": packages,
        "estimated_cost": estimated_cost,
        "from_inventory_qty": round(from_inv, 3),
        "product_url": product.product_url if product else None,
    }


async def _build_shopping_list(
    db: AsyncSession,
    batch_id: int,
    recipe_portions: list[tuple[Recipe, int]],
) -> list[ShoppingListItem]:
    needs = await _aggregate_needs(recipe_portions)
    inv_by_ingredient, best_product = await _resolve_inventory_and_products(db, list(needs.keys()))

    # Pre-load ingredients so we can pass canonical_name to the row builder
    ing_q_persist = select(IngredientMaster).where(IngredientMaster.id.in_(list(needs.keys())))
    ings_by_id_persist = {i.id: i for i in (await db.execute(ing_q_persist)).scalars().all()}

    items: list[ShoppingListItem] = []
    for ingredient_id, unit_map in needs.items():
        for unit, total_needed in unit_map.items():
            row = _compute_shopping_row(
                ingredient_id,
                unit,
                total_needed,
                inv_by_ingredient.get(ingredient_id, []),
                best_product.get(ingredient_id),
                canonical_name=getattr(ings_by_id_persist.get(ingredient_id), "canonical_name", None),
            )
            sli = ShoppingListItem(batch_id=batch_id, **row)
            db.add(sli)
            items.append(sli)
    return items


async def _build_shopping_list_preview(
    db: AsyncSession,
    recipe_portions: list[tuple[Recipe, int]],
) -> list[dict]:
    """Like _build_shopping_list but returns dicts and does not touch the session.
    Each row also contains pre-loaded `ingredient` and `store` brief dicts so the
    response can render without extra round trips.
    """
    needs = await _aggregate_needs(recipe_portions)
    if not needs:
        return []

    inv_by_ingredient, best_product = await _resolve_inventory_and_products(db, list(needs.keys()))

    ing_q = select(IngredientMaster).where(IngredientMaster.id.in_(list(needs.keys())))
    ing_by_id = {i.id: i for i in (await db.execute(ing_q)).scalars().all()}

    store_ids = {p.store_id for p in best_product.values() if p.store_id}
    store_by_id: dict[int, Store] = {}
    if store_ids:
        store_q = select(Store).where(Store.id.in_(store_ids))
        store_by_id = {s.id: s for s in (await db.execute(store_q)).scalars().all()}

    rows: list[dict] = []
    for ingredient_id, unit_map in needs.items():
        for unit, total_needed in unit_map.items():
            row = _compute_shopping_row(
                ingredient_id,
                unit,
                total_needed,
                inv_by_ingredient.get(ingredient_id, []),
                best_product.get(ingredient_id),
                canonical_name=getattr(ing_by_id.get(ingredient_id), "canonical_name", None),
            )
            ing = ing_by_id.get(ingredient_id)
            row["ingredient"] = (
                {
                    "id": ing.id,
                    "canonical_name": ing.canonical_name,
                    "display_name_fr": ing.display_name_fr,
                }
                if ing
                else None
            )
            store = store_by_id.get(row["store_id"]) if row["store_id"] else None
            row["store"] = (
                {"id": store.id, "code": store.code, "name": store.name} if store else None
            )
            rows.append(row)
    return rows


async def compute_batch_preview(
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
) -> dict:
    """Return a preview dict without persisting anything to the DB."""
    selected = await select_recipes(
        db,
        exclude_ids=exclude_ids,
        num_recipes=num_recipes,
        meal_type_sequence=meal_type_sequence,
        vegetarian_only=vegetarian_only,
        vegan_only=vegan_only,
        max_cost_per_portion=max_cost_per_portion,
        prep_time_max_min=prep_time_max_min,
        health_score_min=health_score_min,
        include_recipe_ids=include_recipe_ids,
    )
    return await preview_for_recipes(db, target_portions, selected)


async def preview_for_recipes(
    db: AsyncSession,
    target_portions: int,
    selected: list[Recipe],
) -> dict:
    """Build a preview dict from a pre-selected recipe list."""
    n = len(selected)
    portions_split = _split_portions(target_portions, n)
    pairs = list(zip(selected, portions_split))

    shopping_rows = await _build_shopping_list_preview(db, pairs)
    total_cost = sum((row.get("estimated_cost") or 0) for row in shopping_rows)

    # Price coverage: % of ingredients with a known price
    priced = sum(1 for row in shopping_rows if row.get("estimated_cost") is not None)
    total_rows = len(shopping_rows)
    price_coverage = round(priced / total_rows, 4) if total_rows > 0 else 1.0

    unpriced_ingredients: list[str] = []
    for row in shopping_rows:
        if row.get("estimated_cost") is None and row.get("ingredient"):
            name = row["ingredient"].get("display_name_fr") or row["ingredient"].get("canonical_name", "")
            if name and name not in unpriced_ingredients:
                unpriced_ingredients.append(name)

    recipes_out = [
        {
            "id": r.id,
            "title": r.title,
            "image_url": r.image_url,
            "meal_type": r.meal_type,
            "health_score": r.health_score,
            "estimated_cost_per_portion": r.estimated_cost_per_portion,
            "is_vegetarian": bool(r.is_vegetarian),
            "is_vegan": bool(r.is_vegan),
            "portions": p,
        }
        for r, p in pairs
    ]
    return {
        "target_portions": target_portions,
        "total_portions": sum(portions_split),
        "total_estimated_cost": round(total_cost, 2),
        "price_coverage": price_coverage,
        "unpriced_ingredients": unpriced_ingredients,
        "recipes": recipes_out,
        "shopping_items": shopping_rows,
    }


async def persist_batch_from_slots(
    db: AsyncSession,
    target_portions: int,
    slots: list[tuple[int, int]],  # [(recipe_id, portions), ...]
    name: str | None = None,
) -> Batch:
    """Create a Batch from explicit (recipe_id, portions) slots, build the
    shopping list, commit, and return the Batch with eager-loaded relations.
    """
    if not slots:
        raise ValueError("Aucune recette fournie.")

    recipe_ids = [rid for rid, _ in slots]
    load_opts = selectinload(Recipe.ingredients).selectinload(RecipeIngredient.ingredient)
    q = select(Recipe).options(load_opts).where(Recipe.id.in_(recipe_ids))
    recipes_by_id = {r.id: r for r in (await db.execute(q)).scalars().all()}

    missing = [rid for rid in recipe_ids if rid not in recipes_by_id]
    if missing:
        raise ValueError(f"Recettes introuvables: {missing}")

    pairs: list[tuple[Recipe, int]] = [
        (recipes_by_id[rid], portions) for rid, portions in slots
    ]
    total = sum(p for _, p in pairs)

    batch = Batch(
        name=name,
        target_portions=target_portions,
        total_portions=total,
        status="draft",
    )
    db.add(batch)
    await db.flush()

    for recipe, portions in pairs:
        db.add(BatchRecipe(batch_id=batch.id, recipe_id=recipe.id, portions=portions))

    shopping_items = await _build_shopping_list(db, batch.id, pairs)
    total_cost = sum(item.estimated_cost or 0 for item in shopping_items)
    batch.total_estimated_cost = round(total_cost, 2)

    await db.commit()

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
    """Legacy: select recipes and persist in one shot."""
    selected = await select_recipes(
        db,
        exclude_ids=exclude_ids,
        num_recipes=num_recipes,
        meal_type_sequence=meal_type_sequence,
        vegetarian_only=vegetarian_only,
        vegan_only=vegan_only,
        max_cost_per_portion=max_cost_per_portion,
        prep_time_max_min=prep_time_max_min,
        health_score_min=health_score_min,
        include_recipe_ids=include_recipe_ids,
    )
    portions_split = _split_portions(target_portions, len(selected))
    slots = [(r.id, p) for r, p in zip(selected, portions_split)]
    return await persist_batch_from_slots(db, target_portions, slots)
