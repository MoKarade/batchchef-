import json
from app.utils.time import utcnow
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.store import Store, StoreProduct
from app.models.job import ImportJob
from app.schemas.store import StoreOut, StoreProductOut, MapPricesRequest
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


@router.post("/map-prices", response_model=JobOut, status_code=202)
async def start_price_mapping(
    body: MapPricesRequest,
    db: AsyncSession = Depends(get_db),
):
    """Launch a Celery job that maps Maxi prices onto every IngredientMaster (parents only)."""
    codes = body.store_codes or ["maxi"]
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
