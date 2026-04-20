from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.database import get_db
from app.models.batch import Batch, BatchRecipe, ShoppingListItem
from app.schemas.batch import BatchOut, BatchGenerateRequest
from app.services.batch_generator import generate_batch
from app.services.inventory_manager import settle_shopping_item

router = APIRouter(prefix="/api/batches", tags=["batches"])


@router.post("/generate", response_model=BatchOut, status_code=201)
async def generate(body: BatchGenerateRequest, db: AsyncSession = Depends(get_db)):
    try:
        batch = await generate_batch(
            db,
            target_portions=body.target_portions,
            exclude_ids=body.exclude_recipe_ids or [],
            num_recipes=body.num_recipes,
            meal_type_sequence=body.meal_type_sequence,
            vegetarian_only=body.vegetarian_only,
            vegan_only=body.vegan_only,
            max_cost_per_portion=body.max_cost_per_portion,
            prep_time_max_min=body.prep_time_max_min,
            health_score_min=body.health_score_min,
            include_recipe_ids=body.include_recipe_ids,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return batch


@router.get("", response_model=list[BatchOut])
async def list_batches(db: AsyncSession = Depends(get_db)):
    q = select(Batch).order_by(Batch.id.desc()).limit(20)
    return (await db.execute(q)).scalars().all()


@router.get("/{batch_id}", response_model=BatchOut)
async def get_batch(batch_id: int, db: AsyncSession = Depends(get_db)):
    q = (
        select(Batch)
        .options(
            selectinload(Batch.batch_recipes).selectinload(BatchRecipe.recipe),
            selectinload(Batch.shopping_items).selectinload(ShoppingListItem.ingredient),
            selectinload(Batch.shopping_items).selectinload(ShoppingListItem.store),
            selectinload(Batch.shopping_items).selectinload(ShoppingListItem.store_product),
        )
        .where(Batch.id == batch_id)
    )
    batch = (await db.execute(q)).scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    return batch


@router.patch("/{batch_id}/status")
async def update_status(batch_id: int, status: str, db: AsyncSession = Depends(get_db)):
    batch = await db.get(Batch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    batch.status = status
    await db.commit()
    return {"id": batch_id, "status": status}


@router.patch("/{batch_id}/shopping-items/{item_id}/purchase")
async def mark_item_purchased(
    batch_id: int,
    item_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Mark a shopping item as purchased and push the leftover bulk into inventory."""
    item = await db.get(ShoppingListItem, item_id)
    if not item or item.batch_id != batch_id:
        raise HTTPException(status_code=404, detail="Shopping item not found")
    if item.is_purchased:
        return {"status": "already_purchased", "id": item_id}

    item.is_purchased = True
    item.purchased_at = datetime.utcnow()
    await db.commit()

    surplus = await settle_shopping_item(db, item_id)
    return {
        "status": "ok",
        "id": item_id,
        "surplus_added": surplus.quantity if surplus else 0,
        "surplus_unit": surplus.unit if surplus else None,
    }


@router.patch("/{batch_id}/shopping-items/{item_id}/unpurchase")
async def unmark_item_purchased(
    batch_id: int,
    item_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Undo a purchase mark (does not roll back inventory; use inventory CRUD for that)."""
    item = await db.get(ShoppingListItem, item_id)
    if not item or item.batch_id != batch_id:
        raise HTTPException(status_code=404, detail="Shopping item not found")
    item.is_purchased = False
    item.purchased_at = None
    await db.commit()
    return {"status": "ok", "id": item_id}
