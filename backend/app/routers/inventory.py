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
    for k, v in body.model_dump(exclude_unset=True).items():
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
