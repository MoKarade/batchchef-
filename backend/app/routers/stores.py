import json
from app.utils.time import utcnow
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.store import Store, StoreProduct
from app.models.job import ImportJob
from app.schemas.store import StoreOut, StorePriceUpdate, StoreProductOut, MapPricesRequest
from app.schemas.job import JobOut

router = APIRouter(prefix="/api/stores", tags=["stores"])


@router.get("", response_model=list[StoreOut])
async def list_stores(db: AsyncSession = Depends(get_db)):
    q = select(Store).order_by(Store.id)
    return (await db.execute(q)).scalars().all()


@router.get("/{store_code}/products", response_model=list[StoreProductOut])
async def list_store_products(store_code: str, db: AsyncSession = Depends(get_db)):
    store = (await db.execute(select(Store).where(Store.code == store_code))).scalar_one_or_none()
    if not store:
        raise HTTPException(status_code=404, detail=f"Store '{store_code}' not found")
    q = (
        select(StoreProduct)
        .where(StoreProduct.store_id == store.id)
        .order_by(StoreProduct.id.desc())
    )
    return (await db.execute(q)).scalars().all()


@router.patch("/{store_code}/prices")
async def upsert_fruiterie_price(
    store_code: str,
    body: StorePriceUpdate,
    db: AsyncSession = Depends(get_db),
):
    store = (await db.execute(select(Store).where(Store.code == store_code))).scalar_one_or_none()
    if not store:
        raise HTTPException(status_code=404, detail=f"Store '{store_code}' not found")
    if store.is_transactional:
        raise HTTPException(status_code=400, detail="Use scraper for transactional stores")

    q = select(StoreProduct).where(
        StoreProduct.store_id == store.id,
        StoreProduct.ingredient_master_id == body.ingredient_master_id,
    )
    product = (await db.execute(q)).scalar_one_or_none()
    if product:
        product.price = body.price
        product.format_qty = body.format_qty
        product.format_unit = body.format_unit
        product.is_validated = True
    else:
        product = StoreProduct(
            ingredient_master_id=body.ingredient_master_id,
            store_id=store.id,
            price=body.price,
            format_qty=body.format_qty,
            format_unit=body.format_unit,
            is_validated=True,
            confidence_score=1.0,
        )
        db.add(product)

    await db.commit()
    return {"status": "ok", "store": store_code}


@router.post("/map-prices", response_model=JobOut, status_code=202)
async def start_price_mapping(
    body: MapPricesRequest,
    db: AsyncSession = Depends(get_db),
):
    """Launch a Celery job that maps Maxi + Costco prices onto every IngredientMaster."""
    codes = body.store_codes or ["maxi", "costco"]
    job = ImportJob(
        job_type="price_mapping",
        status="queued",
        progress_total=0,
        metadata_json=json.dumps({"store_codes": codes, "ingredient_ids": body.ingredient_ids}),
    )
    db.add(job)
    await db.flush()
    await db.refresh(job)

    try:
        from app.workers.map_prices import run_price_mapping
        task = run_price_mapping.delay(job.id, codes, body.ingredient_ids)
        job.celery_task_id = task.id
        job.status = "running"
        job.started_at = utcnow()
    except Exception as e:
        job.status = "failed"
        job.error_log = json.dumps([str(e)])

    await db.commit()
    await db.refresh(job)
    return job


@router.post("/fruiterie_440/estimate-prices", response_model=JobOut, status_code=202)
async def start_fruiterie_estimation(
    ingredient_ids: list[int] | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Launch a Celery job that AI-estimates Fruiterie 440 prices for every IngredientMaster."""
    job = ImportJob(
        job_type="fruiterie_estimate",
        status="queued",
        progress_total=0,
        metadata_json=json.dumps({"ingredient_ids": ingredient_ids}),
    )
    db.add(job)
    await db.flush()
    await db.refresh(job)

    try:
        from app.workers.estimate_fruiterie_prices import run_estimate_fruiterie
        task = run_estimate_fruiterie.delay(job.id, ingredient_ids)
        job.celery_task_id = task.id
        job.status = "running"
        job.started_at = utcnow()
    except Exception as e:
        job.status = "failed"
        job.error_log = json.dumps([str(e)])

    await db.commit()
    await db.refresh(job)
    return job


@router.post("/validate-prices", response_model=JobOut, status_code=202)
async def start_price_validation(
    max_items: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger the periodic price validator (normally runs via Celery Beat)."""
    job = ImportJob(
        job_type="price_validation",
        status="queued",
        progress_total=max_items or 0,
        metadata_json=json.dumps({"max_items": max_items}),
    )
    db.add(job)
    await db.flush()
    await db.refresh(job)

    try:
        from app.workers.validate_prices import run_price_validation
        task = run_price_validation.delay(max_items)
        job.celery_task_id = task.id
        job.status = "running"
        job.started_at = utcnow()
    except Exception as e:
        job.status = "failed"
        job.error_log = json.dumps([str(e)])

    await db.commit()
    await db.refresh(job)
    return job
