"""One-shot migration: clean corrupted canonical_names across IngredientMaster.

Loads every IngredientMaster, runs `ai.name_cleaner.clean_canonical` on its
canonical_name, and:
  * if the cleaned name is different and already exists as another row:
    re-point every RecipeIngredient / StoreProduct / ShoppingListItem
    that used the old row to the good row, then delete the corrupted row.
  * if the cleaned name doesn't exist yet: rename the row in place.
  * if the cleaner returns None (unparseable garbage like "es"): leave
    the row alone but log it.

Run:  uv run python scripts/migrate_canonical_names.py [--dry]

After migration the top offenders should collapse:
  ousses_dail (1501), à_soupe_dhuile (265), à_café_de_sel (206), … → ail, huile_olive, sel, …
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select, update, delete

from app.database import AsyncSessionLocal, init_db
from app.models.ingredient import IngredientMaster
from app.models.recipe import RecipeIngredient
from app.models.store import StoreProduct
from app.models.batch import ShoppingListItem
from app.models.inventory import InventoryItem, InventoryMovement
from app.models.receipt import ReceiptItem
from app.ai.name_cleaner import clean_canonical


DRY = "--dry" in sys.argv


async def main():
    await init_db()

    async with AsyncSessionLocal() as db:
        all_ings = list((await db.execute(select(IngredientMaster))).scalars().all())
    print(f"loaded {len(all_ings)} ingredients")

    renamed = 0
    merged = 0
    unchanged = 0
    dropped = 0

    # Build a canonical_name → ingredient_id map of the *current* state
    by_name: dict[str, IngredientMaster] = {i.canonical_name: i for i in all_ings}

    # Plan: { bad_id: ("merge", good_id) | ("rename", new_canonical) | None }
    plan: dict[int, tuple[str, object]] = {}

    for ing in all_ings:
        cleaned = clean_canonical(ing.canonical_name)
        if cleaned is None:
            dropped += 1
            continue
        if cleaned == ing.canonical_name:
            unchanged += 1
            continue
        existing = by_name.get(cleaned)
        if existing and existing.id != ing.id:
            plan[ing.id] = ("merge", existing.id)
            merged += 1
        else:
            plan[ing.id] = ("rename", cleaned)
            by_name.pop(ing.canonical_name, None)
            by_name[cleaned] = ing
            renamed += 1

    print(f"plan: rename={renamed}  merge={merged}  unchanged={unchanged}  dropped={dropped}")

    # Show first 15 rename + first 15 merge actions
    for bad_id, (op, val) in list(plan.items())[:15]:
        bad = next(i for i in all_ings if i.id == bad_id)
        if op == "merge":
            good = next(i for i in all_ings if i.id == val)
            print(f"  MERGE  {bad.canonical_name:35s} → {good.canonical_name}")
        else:
            print(f"  RENAME {bad.canonical_name:35s} → {val}")

    if DRY:
        print("\n--dry: no changes written")
        return

    # ── apply ──
    async with AsyncSessionLocal() as db:
        # Renames first (no FK headaches since we're not deleting)
        for bad_id, (op, val) in plan.items():
            if op == "rename":
                await db.execute(
                    update(IngredientMaster).where(IngredientMaster.id == bad_id).values(canonical_name=val)
                )
        await db.commit()

        # Merges: repoint FKs then delete the orphan ingredient row
        for bad_id, (op, val) in plan.items():
            if op != "merge":
                continue
            good_id = val
            # Repoint every FK that still points to the corrupted ingredient
            await db.execute(update(RecipeIngredient).where(RecipeIngredient.ingredient_master_id == bad_id)
                             .values(ingredient_master_id=good_id))
            await db.execute(update(StoreProduct).where(StoreProduct.ingredient_master_id == bad_id)
                             .values(ingredient_master_id=good_id))
            await db.execute(update(ShoppingListItem).where(ShoppingListItem.ingredient_master_id == bad_id)
                             .values(ingredient_master_id=good_id))
            await db.execute(update(InventoryItem).where(InventoryItem.ingredient_master_id == bad_id)
                             .values(ingredient_master_id=good_id))
            await db.execute(update(InventoryMovement).where(InventoryMovement.ingredient_master_id == bad_id)
                             .values(ingredient_master_id=good_id))
            await db.execute(update(ReceiptItem).where(ReceiptItem.ingredient_master_id == bad_id)
                             .values(ingredient_master_id=good_id))
            # Drop StoreProduct rows that now duplicate (same ingredient+store+sku)
            await db.execute(delete(IngredientMaster).where(IngredientMaster.id == bad_id))
        await db.commit()

    print("migration done")


if __name__ == "__main__":
    asyncio.run(main())
