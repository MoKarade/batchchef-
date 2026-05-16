from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.database import get_db
from app.models.batch import Batch, BatchRecipe, ShoppingListItem
from app.schemas.batch import BatchOut, BatchGenerateRequest, BatchPreviewOut, BatchAcceptRequest
from app.services.batch_generator import generate_batch, compute_batch_preview, persist_batch_from_slots
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


@router.post("/preview", response_model=BatchPreviewOut)
async def preview(body: BatchGenerateRequest, db: AsyncSession = Depends(get_db)):
    try:
        return await compute_batch_preview(
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
            preferred_stores=body.preferred_stores,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/accept", response_model=BatchOut, status_code=201)
async def accept(body: BatchAcceptRequest, db: AsyncSession = Depends(get_db)):
    from app.services.batch_generator import preview_for_recipes
    from app.models.recipe import Recipe
    from sqlalchemy.orm import selectinload
    from app.models.recipe import RecipeIngredient

    # Gate: verify price coverage before persisting
    recipe_ids = [r.recipe_id for r in body.recipes]
    load_opts = selectinload(Recipe.ingredients).selectinload(RecipeIngredient.ingredient)
    q = select(Recipe).options(load_opts).where(Recipe.id.in_(recipe_ids))
    recipes = list((await db.execute(q)).scalars().all())
    slots = [(r.recipe_id, r.portions) for r in body.recipes]
    preview = await preview_for_recipes(db, body.target_portions, recipes)
    if preview.get("price_coverage", 1.0) < 1.0:
        missing = preview.get("unpriced_ingredients", [])
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INCOMPLETE_PRICING",
                "message": "Certains ingrédients n'ont pas de prix Maxi/Costco.",
                "unpriced_ingredients": missing,
                "price_coverage": preview["price_coverage"],
            },
        )

    try:
        return await persist_batch_from_slots(
            db,
            target_portions=body.target_portions,
            slots=slots,
            name=body.name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


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
