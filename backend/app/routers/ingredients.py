import json
import re
from app.utils.time import utcnow
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, or_, func, update, delete
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, ConfigDict
from app.database import get_db
from app.models.ingredient import IngredientMaster
from app.models.recipe import RecipeIngredient
from app.models.store import StoreProduct
from app.models.inventory import InventoryItem, InventoryMovement
from app.models.batch import ShoppingListItem
from app.models.receipt import ReceiptItem
from app.models.job import ImportJob
from app.schemas.job import JobOut

router = APIRouter(prefix="/api/ingredients", tags=["ingredients"])


class IngredientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    canonical_name: str
    display_name_fr: str
    category: str | None = None
    subcategory: str | None = None
    is_produce: bool = False
    default_unit: str | None = None
    estimated_price_per_kg: float | None = None
    parent_id: int | None = None
    specific_unit: str | None = None
    specific_price_per_unit: float | None = None
    calories_per_100: float | None = None
    proteins_per_100: float | None = None
    carbs_per_100: float | None = None
    lipids_per_100: float | None = None
    price_mapping_status: str = "pending"
    usage_count: int = 0
    store_product_count: int = 0
    children_count: int = 0


class IngredientUpdate(BaseModel):
    display_name_fr: str | None = None
    category: str | None = None
    subcategory: str | None = None
    default_unit: str | None = None
    estimated_price_per_kg: float | None = None
    parent_id: int | None = None
    specific_unit: str | None = None
    specific_price_per_unit: float | None = None
    calories_per_100: float | None = None
    proteins_per_100: float | None = None
    carbs_per_100: float | None = None
    lipids_per_100: float | None = None


_UNSET = object()


def _apply_ingredient_filters(q, search, category, price_mapping_status, parent_id=_UNSET):
    if search:
        pattern = f"%{search.lower()}%"
        q = q.where(or_(
            IngredientMaster.canonical_name.ilike(pattern),
            IngredientMaster.display_name_fr.ilike(pattern),
        ))
    if category:
        q = q.where(IngredientMaster.category == category)
    if price_mapping_status:
        q = q.where(IngredientMaster.price_mapping_status == price_mapping_status)
    if parent_id is not _UNSET:
        if parent_id is None:
            q = q.where(IngredientMaster.parent_id.is_(None))
        else:
            q = q.where(IngredientMaster.parent_id == parent_id)
    return q


def _parse_parent_id(parent_id: str | None):
    if parent_id is None:
        return _UNSET
    if parent_id.lower() in ("null", "none", "root"):
        return None
    try:
        return int(parent_id)
    except ValueError:
        return _UNSET


@router.get("/count", response_model=int)
async def count_ingredients(
    search: str | None = Query(None),
    category: str | None = Query(None),
    price_mapping_status: str | None = Query(None),
    parent_id: str | None = Query(None, description="int, 'null' for top-level, omit for all"),
    db: AsyncSession = Depends(get_db),
):
    q = _apply_ingredient_filters(
        select(func.count(IngredientMaster.id)),
        search, category, price_mapping_status, _parse_parent_id(parent_id),
    )
    total = (await db.execute(q)).scalar() or 0
    return int(total)


@router.get("", response_model=list[IngredientOut])
async def list_ingredients(
    search: str | None = Query(None),
    category: str | None = Query(None),
    price_mapping_status: str | None = Query(None, description="pending|mapped|failed"),
    parent_id: str | None = Query(None, description="int, 'null' for top-level, omit for all"),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    q = _apply_ingredient_filters(
        select(IngredientMaster),
        search, category, price_mapping_status, _parse_parent_id(parent_id),
    ).order_by(IngredientMaster.canonical_name.asc()).limit(limit).offset(offset)

    ingredients = list((await db.execute(q)).scalars().all())
    if not ingredients:
        return []

    ids = [i.id for i in ingredients]
    usage_q = (
        select(RecipeIngredient.ingredient_master_id, func.count(RecipeIngredient.id))
        .where(RecipeIngredient.ingredient_master_id.in_(ids))
        .group_by(RecipeIngredient.ingredient_master_id)
    )
    usage = dict((await db.execute(usage_q)).all())

    prod_q = (
        select(StoreProduct.ingredient_master_id, func.count(StoreProduct.id))
        .where(StoreProduct.ingredient_master_id.in_(ids))
        .group_by(StoreProduct.ingredient_master_id)
    )
    prods = dict((await db.execute(prod_q)).all())

    children_q = (
        select(IngredientMaster.parent_id, func.count(IngredientMaster.id))
        .where(IngredientMaster.parent_id.in_(ids))
        .group_by(IngredientMaster.parent_id)
    )
    children_counts = dict((await db.execute(children_q)).all())

    out: list[IngredientOut] = []
    for ing in ingredients:
        row = IngredientOut.model_validate(ing)
        row.usage_count = int(usage.get(ing.id, 0))
        row.store_product_count = int(prods.get(ing.id, 0))
        row.children_count = int(children_counts.get(ing.id, 0))
        out.append(row)
    return out


@router.get("/categories", response_model=list[str])
async def list_categories(db: AsyncSession = Depends(get_db)):
    q = (
        select(IngredientMaster.category)
        .where(IngredientMaster.category.isnot(None))
        .distinct()
        .order_by(IngredientMaster.category.asc())
    )
    return [c for (c,) in (await db.execute(q)).all() if c]


@router.patch("/{ingredient_id}", response_model=IngredientOut)
async def update_ingredient(
    ingredient_id: int,
    body: IngredientUpdate,
    db: AsyncSession = Depends(get_db),
):
    ing = await db.get(IngredientMaster, ingredient_id)
    if not ing:
        raise HTTPException(status_code=404, detail="Ingredient not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(ing, k, v)
    await db.commit()
    await db.refresh(ing)
    out = IngredientOut.model_validate(ing)
    return out


class SanitizeRequest(BaseModel):
    ingredient_ids: list[int] | None = None


@router.post("/sanitize-names", response_model=JobOut, status_code=202)
async def sanitize_display_names(
    body: SanitizeRequest | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Launch a Celery task that re-cleans IngredientMaster.display_name_fr via Gemini."""
    ingredient_ids = body.ingredient_ids if body else None

    count_q = select(func.count(IngredientMaster.id))
    if ingredient_ids:
        count_q = count_q.where(IngredientMaster.id.in_(ingredient_ids))
    total = int((await db.execute(count_q)).scalar() or 0)

    job = ImportJob(
        job_type="ingredients_sanitize_names",
        status="queued",
        progress_total=total,
        metadata_json=json.dumps({"ingredient_ids": ingredient_ids}),
    )
    db.add(job)
    await db.flush()
    await db.refresh(job)

    try:
        from app.workers.clean_display_names import run_clean_display_names
        task = run_clean_display_names.delay(job.id, ingredient_ids)
        job.celery_task_id = task.id
        job.status = "running"
        job.started_at = utcnow()
    except Exception as e:
        job.status = "failed"
        job.error_log = json.dumps([str(e)])

    await db.commit()
    await db.refresh(job)
    return job


_BAD_CANONICAL = re.compile(r"^[\s\-_\d,./]+")


def _clean_canonical(raw: str) -> str:
    c = (raw or "").lower().strip()
    c = _BAD_CANONICAL.sub("", c)
    c = re.sub(r"\s+", "_", c)
    c = re.sub(r"_+", "_", c).strip("_ ")
    return c


class RepairResult(BaseModel):
    scanned: int
    renamed: int
    merged: int
    skipped: int


@router.post("/repair-prefixes", response_model=RepairResult)
async def repair_prefixes(db: AsyncSession = Depends(get_db)):
    """Strip bogus leading digits/dashes from canonical_name + display_name.

    If the cleaned canonical already exists as another row, merge FKs into it
    and drop the corrupted row. Otherwise rename in place.
    """
    q = select(IngredientMaster)
    rows = list((await db.execute(q)).scalars().all())

    scanned = 0
    renamed = 0
    merged = 0
    skipped = 0

    for ing in rows:
        if not _BAD_CANONICAL.match(ing.canonical_name or ""):
            continue
        scanned += 1
        clean = _clean_canonical(ing.canonical_name)
        if not clean or len(clean) < 2:
            skipped += 1
            continue

        # Try to find an existing clean twin
        twin_q = select(IngredientMaster).where(
            IngredientMaster.canonical_name == clean,
            IngredientMaster.id != ing.id,
        )
        twin = (await db.execute(twin_q)).scalar_one_or_none()

        new_display = clean.replace("_", " ").capitalize()

        if twin:
            # Reassign FKs to twin and delete the bad row
            for model, col in (
                (RecipeIngredient, RecipeIngredient.ingredient_master_id),
                (StoreProduct, StoreProduct.ingredient_master_id),
                (InventoryItem, InventoryItem.ingredient_master_id),
                (InventoryMovement, InventoryMovement.ingredient_master_id),
                (ShoppingListItem, ShoppingListItem.ingredient_master_id),
                (ReceiptItem, ReceiptItem.ingredient_master_id),
            ):
                await db.execute(
                    update(model).where(col == ing.id).values(ingredient_master_id=twin.id)
                )
            # Clear any self-parent references pointing at the bad row
            await db.execute(
                update(IngredientMaster)
                .where(IngredientMaster.parent_id == ing.id)
                .values(parent_id=twin.id)
            )
            await db.execute(delete(IngredientMaster).where(IngredientMaster.id == ing.id))
            merged += 1
        else:
            ing.canonical_name = clean
            # Only overwrite display if it looks corrupted too
            if _BAD_CANONICAL.match(ing.display_name_fr or ""):
                ing.display_name_fr = new_display
            renamed += 1

    await db.commit()
    return RepairResult(scanned=scanned, renamed=renamed, merged=merged, skipped=skipped)


@router.post("/{ingredient_id}/unmap", response_model=IngredientOut)
async def unmap_ingredient(ingredient_id: int, db: AsyncSession = Depends(get_db)):
    """Reset an ingredient to 'pending' so it re-enters the price-mapping queue.

    Invalidates its StoreProducts so the next mapping pass regenerates them.
    """
    ing = await db.get(IngredientMaster, ingredient_id)
    if not ing:
        raise HTTPException(status_code=404, detail="Ingredient not found")
    ing.price_mapping_status = "pending"
    ing.last_price_mapping_at = None

    sp_q = select(StoreProduct).where(StoreProduct.ingredient_master_id == ingredient_id)
    for sp in (await db.execute(sp_q)).scalars().all():
        sp.is_validated = False

    await db.commit()
    await db.refresh(ing)
    out = IngredientOut.model_validate(ing)
    return out
