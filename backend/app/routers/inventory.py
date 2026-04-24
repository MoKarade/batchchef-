from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.inventory import InventoryItem, InventoryMovement
from app.schemas.inventory import InventoryItemOut, InventoryItemCreate, InventoryItemUpdate, MovementOut

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


@router.get("", response_model=list[InventoryItemOut])
async def list_inventory(db: AsyncSession = Depends(get_db)):
    q = select(InventoryItem).options(selectinload(InventoryItem.ingredient)).order_by(InventoryItem.id.desc())
    return (await db.execute(q)).scalars().all()


@router.post("", response_model=InventoryItemOut, status_code=201)
async def create_item(body: InventoryItemCreate, db: AsyncSession = Depends(get_db)):
    item = InventoryItem(**body.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=InventoryItemOut)
async def update_item(item_id: int, body: InventoryItemUpdate, db: AsyncSession = Depends(get_db)):
    item = await db.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    patch = body.model_dump(exclude_unset=True)
    # Unit-change auto-convert: if the user switches the unit (e.g. "2 L"
    # → "ml") without touching quantity, we translate the stored qty into
    # the new unit's base so totals stay consistent. Without this, the
    # inventory grows/shrinks by a factor of 1000× silently.
    from app.services.unit_converter import to_base, normalize_unit
    if "unit" in patch and patch["unit"] and patch["unit"] != item.unit:
        # Only auto-convert when the user DIDN'T also explicitly set qty
        # (in which case we trust their new value).
        if "quantity" not in patch:
            old_base, old_kind = normalize_unit(item.unit)
            new_base, new_kind = normalize_unit(patch["unit"])
            if old_kind == new_kind:
                qty_in_base = to_base(float(item.quantity), item.unit)
                # Convert base → new unit: invert to_base(1, new_unit)
                factor_for_new = to_base(1.0, patch["unit"])
                if factor_for_new > 0:
                    patch["quantity"] = round(qty_in_base / factor_for_new, 3)
            else:
                raise HTTPException(
                    422,
                    f"Unité incompatible: {item.unit} ({old_kind}) → {patch['unit']} ({new_kind}). "
                    "Fournis aussi la nouvelle quantity.",
                )

    for k, v in patch.items():
        setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
async def delete_item(item_id: int, db: AsyncSession = Depends(get_db)):
    item = await db.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.delete(item)
    await db.commit()


@router.get("/movements", response_model=list[MovementOut])
async def list_movements(ingredient_id: int | None = None, db: AsyncSession = Depends(get_db)):
    q = select(InventoryMovement).order_by(InventoryMovement.created_at.desc()).limit(100)
    if ingredient_id:
        q = q.where(InventoryMovement.ingredient_master_id == ingredient_id)
    return (await db.execute(q)).scalars().all()
