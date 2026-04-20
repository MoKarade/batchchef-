"""Inventory update helpers."""
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.inventory import InventoryItem, InventoryMovement
from app.models.receipt import ReceiptScan, ReceiptItem
from app.models.batch import ShoppingListItem
from app.services.unit_converter import to_base, normalize_unit


async def add_from_receipt(db: AsyncSession, scan_id: int, confirmed_item_ids: list[int]):
    q = select(ReceiptItem).where(
        ReceiptItem.receipt_scan_id == scan_id,
        ReceiptItem.id.in_(confirmed_item_ids),
        ReceiptItem.ingredient_master_id.isnot(None),
    )
    items = list((await db.execute(q)).scalars().all())

    for item in items:
        item.is_confirmed = True
        inv_q = select(InventoryItem).where(
            InventoryItem.ingredient_master_id == item.ingredient_master_id
        )
        inv = (await db.execute(inv_q)).scalar_one_or_none()
        qty = item.quantity or 1.0
        unit = item.unit or "unite"

        if inv:
            if inv.unit == unit:
                inv.quantity += qty
            else:
                inv = None

        if inv is None:
            inv = InventoryItem(
                ingredient_master_id=item.ingredient_master_id,
                quantity=qty,
                unit=unit,
                purchased_at=datetime.utcnow(),
            )
            db.add(inv)

        db.add(InventoryMovement(
            ingredient_master_id=item.ingredient_master_id,
            change_qty=qty,
            unit=unit,
            movement_type="receipt_scan",
            source_ref_type="receipt",
            source_ref_id=scan_id,
        ))

    scan = await db.get(ReceiptScan, scan_id)
    if scan:
        scan.status = "completed"
        scan.scanned_at = datetime.utcnow()

    await db.commit()


async def settle_shopping_item(db: AsyncSession, shopping_item_id: int) -> InventoryItem | None:
    """
    When a ShoppingListItem is marked as purchased, compute the surplus between
    what was bought (packages_to_buy * format_qty) and what the batch consumes
    (quantity_needed). The surplus is added as a new InventoryItem so the next
    batch can draw from it (e.g. 5 kg rice bag - 500 g need = 4.5 kg surplus).

    Returns the InventoryItem holding the surplus, or None if no surplus.
    """
    item = await db.get(ShoppingListItem, shopping_item_id)
    if not item:
        return None

    bought_qty = (item.packages_to_buy or 1) * (item.format_qty or 0.0)
    format_unit = item.format_unit or item.unit
    if bought_qty <= 0 or not format_unit:
        return None

    bought_base = to_base(bought_qty, format_unit)
    needed_base = to_base(item.quantity_needed or 0.0, item.unit)
    base_unit, _ = normalize_unit(format_unit)

    # Log the consumption (batch draws its part)
    if needed_base > 0:
        db.add(InventoryMovement(
            ingredient_master_id=item.ingredient_master_id,
            change_qty=-needed_base,
            unit=base_unit,
            movement_type="batch_consumption",
            source_ref_type="batch",
            source_ref_id=item.batch_id,
        ))

    surplus_base = bought_base - needed_base
    if surplus_base <= 0:
        await db.commit()
        return None

    inv = InventoryItem(
        ingredient_master_id=item.ingredient_master_id,
        quantity=round(surplus_base, 3),
        unit=base_unit,
        source_store_product_id=item.store_product_id,
        purchased_at=datetime.utcnow(),
        notes=f"Surplus d'achat batch #{item.batch_id}",
    )
    db.add(inv)
    db.add(InventoryMovement(
        ingredient_master_id=item.ingredient_master_id,
        change_qty=round(surplus_base, 3),
        unit=base_unit,
        movement_type="purchase",
        source_ref_type="batch",
        source_ref_id=item.batch_id,
    ))
    await db.commit()
    await db.refresh(inv)
    return inv
