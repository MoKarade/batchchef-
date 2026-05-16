import json
from app.utils.time import utcnow
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.job import ImportJob
from app.schemas.job import JobOut

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/full-backfill", response_model=list[JobOut], status_code=202)
async def full_backfill(db: AsyncSession = Depends(get_db)):
    """Launch a complete price re-mapping: Maxi+Costco for all grocery ingredients
    + Fruiterie estimate for all produce ingredients, then recompute recipe costs."""
    jobs_created: list[ImportJob] = []

    # Job 1: full price mapping (Maxi + Costco, all ingredients)
    map_job = ImportJob(
        job_type="prices_map",
        status="queued",
        progress_total=0,
        metadata_json=json.dumps({"store_codes": None, "ingredient_ids": None, "source": "full_backfill"}),
    )
    db.add(map_job)
    await db.flush()
    await db.refresh(map_job)

    try:
        from app.workers.map_prices import run_price_mapping
        task = run_price_mapping.delay(map_job.id, None, None)
        map_job.celery_task_id = task.id
        map_job.status = "running"
        map_job.started_at = utcnow()
    except Exception as e:
        map_job.status = "failed"
        map_job.error_log = json.dumps([str(e)])
    jobs_created.append(map_job)

    # Job 2: fruiterie price estimation (all produce)
    fruit_job = ImportJob(
        job_type="fruiterie_estimate",
        status="queued",
        progress_total=0,
        metadata_json=json.dumps({"ingredient_ids": None, "source": "full_backfill"}),
    )
    db.add(fruit_job)
    await db.flush()
    await db.refresh(fruit_job)

    try:
        from app.workers.estimate_fruiterie_prices import run_estimate_fruiterie
        task2 = run_estimate_fruiterie.delay(fruit_job.id, None)
        fruit_job.celery_task_id = task2.id
        fruit_job.status = "running"
        fruit_job.started_at = utcnow()
    except Exception as e:
        fruit_job.status = "failed"
        fruit_job.error_log = json.dumps([str(e)])
    jobs_created.append(fruit_job)

    await db.commit()
    for j in jobs_created:
        await db.refresh(j)
    return jobs_created
