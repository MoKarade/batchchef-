"""Inventory service tests: surplus vrac + add_from_receipt."""
import pytest
from sqlalchemy import select

from app.models.ingredient import IngredientMaster
from app.models.batch import Batch, ShoppingListItem
from app.models.receipt import ReceiptScan, ReceiptItem
from app.models.inventory import InventoryItem, InventoryMovement
from app.services.inventory_manager import settle_shopping_item, add_from_receipt


@pytest.mark.asyncio
async def test_settle_shopping_item_creates_surplus(db):
    """5 kg rice bag - 500 g need → 4500 g surplus."""
    ing = IngredientMaster(canonical_name="riz", display_name_fr="Riz", default_unit="g")
    db.add(ing)
    batch = Batch(target_portions=10, total_portions=10, status="shopping")
    db.add(batch)
    await db.flush()

    item = ShoppingListItem(
        batch_id=batch.id,
        ingredient_master_id=ing.id,
        quantity_needed=500.0,
        unit="g",
        format_qty=5.0,
        format_unit="kg",
        packages_to_buy=1,
    )
    db.add(item)
    await db.commit()

    inv = await settle_shopping_item(db, item.id)
    assert inv is not None
    assert inv.unit == "g"
    assert inv.quantity == pytest.approx(4500.0)

    # Movements: one consumption (-500 g), one purchase (+4500 g)
    mvs = list((await db.execute(
        select(InventoryMovement).where(InventoryMovement.ingredient_master_id == ing.id)
    )).scalars().all())
    assert len(mvs) == 2
    types = {m.movement_type for m in mvs}
    assert types == {"batch_consumption", "purchase"}


@pytest.mark.asyncio
async def test_settle_shopping_item_no_surplus_when_exact(db):
    ing = IngredientMaster(canonical_name="oeuf", display_name_fr="Oeuf", default_unit="unite")
    db.add(ing)
    batch = Batch(target_portions=6, total_portions=6, status="shopping")
    db.add(batch)
    await db.flush()

    item = ShoppingListItem(
        batch_id=batch.id,
        ingredient_master_id=ing.id,
        quantity_needed=6.0,
        unit="unite",
        format_qty=6.0,
        format_unit="unite",
        packages_to_buy=1,
    )
    db.add(item)
    await db.commit()

    inv = await settle_shopping_item(db, item.id)
    assert inv is None


@pytest.mark.asyncio
async def test_add_from_receipt_creates_inventory(db):
    ing = IngredientMaster(canonical_name="tomate", display_name_fr="Tomate", default_unit="g")
    db.add(ing)
    await db.flush()

    scan = ReceiptScan(image_path="/tmp/x.jpg", status="processing")
    db.add(scan)
    await db.flush()

    item = ReceiptItem(
        receipt_scan_id=scan.id,
        raw_name="TOMATES 1KG",
        ingredient_master_id=ing.id,
        quantity=1000.0,
        unit="g",
    )
    db.add(item)
    await db.commit()

    await add_from_receipt(db, scan.id, [item.id])

    invs = list((await db.execute(
        select(InventoryItem).where(InventoryItem.ingredient_master_id == ing.id)
    )).scalars().all())
    assert len(invs) == 1
    assert invs[0].quantity == 1000.0
    assert invs[0].unit == "g"

    refreshed_scan = await db.get(ReceiptScan, scan.id)
    assert refreshed_scan.status == "completed"

    refreshed_item = await db.get(ReceiptItem, item.id)
    assert refreshed_item.is_confirmed is True


@pytest.mark.asyncio
async def test_add_from_receipt_merges_same_unit(db):
    ing = IngredientMaster(canonical_name="pomme", display_name_fr="Pomme", default_unit="unite")
    db.add(ing)
    await db.flush()

    # Pre-existing inventory
    db.add(InventoryItem(ingredient_master_id=ing.id, quantity=3.0, unit="unite"))

    scan = ReceiptScan(image_path="/tmp/y.jpg", status="processing")
    db.add(scan)
    await db.flush()

    item = ReceiptItem(
        receipt_scan_id=scan.id, raw_name="POMMES x4",
        ingredient_master_id=ing.id, quantity=4.0, unit="unite",
    )
    db.add(item)
    await db.commit()

    await add_from_receipt(db, scan.id, [item.id])

    invs = list((await db.execute(
        select(InventoryItem).where(InventoryItem.ingredient_master_id == ing.id)
    )).scalars().all())
    assert len(invs) == 1
    assert invs[0].quantity == pytest.approx(7.0)
