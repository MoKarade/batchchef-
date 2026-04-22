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
from app.models.ingredient import IngredientMaster
from app.models.batch import Batch, BatchRecipe, ShoppingListItem
from app.models.store import StoreProduct, Store
from app.models.inventory import InventoryItem
from app.services.unit_converter import get_scale_factor, to_base, convert_count_to_mass, normalize_unit

_TPS_RATE = 0.05
_TVQ_RATE = 0.09975


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
    """Select diverse recipes according to the given filters."""
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
        .where(Recipe.pricing_status == "complete")
    ).order_by((func.coalesce(Recipe.health_score, 0) + func.random() * 3).desc()).limit(50)
    candidates = list((await db.execute(q)).scalars().all())

    if len(candidates) + len(forced) < num_recipes:
        # Relax status filter
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

    return selected[:num_recipes]


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


async def _aggregate_needs(recipe_portions: list[tuple[Recipe, int]]) -> dict[int, dict[str, float]]:
    """Aggregate recipe ingredients into needs by ingredient_master_id and unit.
    Variants (e.g. 'beurre_fondu') roll up to their parent (e.g. 'beurre').
    """
    needs: dict[int, dict[str, float]] = {}
    for recipe, portions in recipe_portions:
        for ri in recipe.ingredients:
            if not ri.ingredient_master_id or not ri.quantity_per_portion:
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
    db: AsyncSession,
    ingredient_ids: list[int],
    preferred_store_codes: list[str] | None = None,
) -> tuple[dict[int, list[InventoryItem]], dict[int, StoreProduct], dict[str, dict[int, StoreProduct]]]:
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
            StoreProduct.is_validated.desc(),
            StoreProduct.price.asc(),
        )
    )
    all_products = list((await db.execute(products_q)).scalars().all())

    # Load store codes for cheapest-per-store grouping
    store_ids = {p.store_id for p in all_products if p.store_id}
    store_code_by_id: dict[int, str] = {}
    if store_ids:
        from app.models.store import Store as StoreModel
        store_code_q = select(StoreModel.id, StoreModel.code).where(StoreModel.id.in_(store_ids))
        for sid, code in (await db.execute(store_code_q)).all():
            store_code_by_id[sid] = code

    # Group cheapest product per store per ingredient
    products_by_store: dict[str, dict[int, StoreProduct]] = {}
    for p in all_products:
        code = store_code_by_id.get(p.store_id or 0, "")
        if not code:
            continue
        products_by_store.setdefault(code, {})
        if p.ingredient_master_id not in products_by_store[code]:
            products_by_store[code][p.ingredient_master_id] = p

    # best_product: preferred stores first, then global fallback
    preferred = set(preferred_store_codes or [])
    best_product: dict[int, StoreProduct] = {}
    if preferred:
        for code, by_ing in products_by_store.items():
            if code in preferred:
                for ing_id, p in by_ing.items():
                    if ing_id not in best_product or (p.price or 0) < (best_product[ing_id].price or 0):
                        best_product[ing_id] = p
        # fallback: ingredients missing from preferred stores
        for p in all_products:
            if p.ingredient_master_id not in best_product:
                best_product[p.ingredient_master_id] = p
    else:
        for p in all_products:
            if p.ingredient_master_id not in best_product:
                best_product[p.ingredient_master_id] = p

    return inv_by_ingredient, best_product, products_by_store


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
        # Fallback: recipe uses count ("12 abricots") but store sells by mass
        # (200 g). Convert count → grams so we don't end up with absurd counts
        # like "48 abricots". Requires an entry in WEIGHT_PER_UNIT_G.
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
    inv_by_ingredient, best_product, _ = await _resolve_inventory_and_products(db, list(needs.keys()))

    # Pre-load ingredients so we can pass canonical_name for count→mass fallback
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
    preferred_store_codes: list[str] | None = None,
) -> tuple[list[dict], dict[str, float]]:
    """Like _build_shopping_list but returns (rows, totals_by_mode) without touching the session."""
    needs = await _aggregate_needs(recipe_portions)
    if not needs:
        return [], {}

    inv_by_ingredient, best_product, products_by_store = await _resolve_inventory_and_products(
        db, list(needs.keys()), preferred_store_codes
    )

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
                canonical_name=getattr(ing_by_id.get(ingredient_id) if "ing_by_id" in locals() else None, "canonical_name", None),
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
            row["is_taxable"] = bool(ing.is_taxable) if ing else False
            store = store_by_id.get(row["store_id"]) if row["store_id"] else None
            row["store"] = (
                {"id": store.id, "code": store.code, "name": store.name} if store else None
            )
            rows.append(row)

    # Compute total cost per store mode
    totals_by_mode: dict[str, float] = {}
    for store_code, store_products in products_by_store.items():
        mode_cost = 0.0
        for ingredient_id, unit_map in needs.items():
            for unit, total_needed in unit_map.items():
                r = _compute_shopping_row(
                    ingredient_id, unit, total_needed,
                    inv_by_ingredient.get(ingredient_id, []),
                    store_products.get(ingredient_id),
                )
                mode_cost += r.get("estimated_cost") or 0
        totals_by_mode[store_code] = round(mode_cost, 2)
    totals_by_mode["mixte"] = round(sum((r.get("estimated_cost") or 0) for r in rows), 2)

    return rows, totals_by_mode


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
    preferred_stores: list[str] | None = None,
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
    return await preview_for_recipes(db, target_portions, selected, preferred_store_codes=preferred_stores)


async def preview_for_recipes(
    db: AsyncSession,
    target_portions: int,
    selected: list[Recipe],
    preferred_store_codes: list[str] | None = None,
) -> dict:
    """Build a preview dict from a pre-selected recipe list."""
    n = len(selected)

    # Portion split: e.g. 20 portions / 3 recipes → [7, 7, 6]
    base = target_portions // n
    remainder = target_portions % n
    portions_split = [base + (1 if i < remainder else 0) for i in range(n)]

    pairs = list(zip(selected, portions_split))

    shopping_rows, totals_by_mode = await _build_shopping_list_preview(db, pairs, preferred_store_codes)
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

    # Quebec taxes on taxable items
    taxable_cost = sum((r.get("estimated_cost") or 0) for r in shopping_rows if r.get("is_taxable"))
    taxes_tps = round(taxable_cost * _TPS_RATE, 2)
    taxes_tvq = round(taxable_cost * _TVQ_RATE, 2)
    total_with_taxes = round(total_cost + taxes_tps + taxes_tvq, 2)

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
        "taxes_tps": taxes_tps,
        "taxes_tvq": taxes_tvq,
        "total_with_taxes": total_with_taxes,
        "price_coverage": price_coverage,
        "unpriced_ingredients": unpriced_ingredients,
        "recipes": recipes_out,
        "shopping_items": shopping_rows,
        "totals_by_mode": totals_by_mode,
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
        target_portions=target_portions,
        total_portions=total,
        name=name,
        status="draft",
    )
    db.add(batch)
    await db.flush()

    for recipe, portions in pairs:
        db.add(BatchRecipe(batch_id=batch.id, recipe_id=recipe.id, portions=portions))

    # Build shopping list
    shopping_items = await _build_shopping_list(db, batch.id, pairs)
    total_cost = sum(item.estimated_cost or 0 for item in shopping_items)
    batch.total_estimated_cost = round(total_cost, 2)

    await db.commit()

    # Reload with eager-loaded relationships
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
