import json
from app.utils.time import utcnow
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.job import ImportJob
from app.schemas.job import JobOut, ImportStartRequest

router = APIRouter(prefix="/api/imports", tags=["imports"])

DATA_DIR = Path(__file__).parent.parent.parent.parent / "data"


@router.post("/marmiton", response_model=JobOut, status_code=202)
async def start_marmiton_import(
    body: ImportStartRequest,
    db: AsyncSession = Depends(get_db),
):
    urls_file = DATA_DIR / "cleaned_recipes.txt"
    if not urls_file.exists():
        raise HTTPException(status_code=404, detail="cleaned_recipes.txt not found in data/")

    all_urls = urls_file.read_text(encoding="utf-8").splitlines()
    all_urls = [u.strip() for u in all_urls if u.strip().startswith("http")]

    if body.limit:
        all_urls = all_urls[: body.limit]

    job = ImportJob(
        job_type="marmiton_bulk",
        status="queued",
        progress_total=len(all_urls),
        metadata_json=json.dumps({"urls_count": len(all_urls)}),
    )
    db.add(job)
    await db.flush()
    await db.refresh(job)

    # Fire Celery task
    try:
        from app.workers.import_marmiton import run_marmiton_import
        task = run_marmiton_import.delay(job.id, all_urls)
        job.celery_task_id = task.id
        job.status = "running"
        job.started_at = utcnow()
    except Exception as e:
        job.status = "failed"
        job.error_log = json.dumps([str(e)])

    await db.commit()
    await db.refresh(job)
    return job


@router.get("/{job_id}", response_model=JobOut)
async def get_import_job(job_id: int, db: AsyncSession = Depends(get_db)):
    job = await db.get(ImportJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("", response_model=list[JobOut])
async def list_jobs(db: AsyncSession = Depends(get_db)):
    q = select(ImportJob).order_by(ImportJob.id.desc()).limit(20)
    return (await db.execute(q)).scalars().all()


@router.post("/{job_id}/cancel", response_model=JobOut, status_code=202)
async def cancel_import(job_id: int, db: AsyncSession = Depends(get_db)):
    job = await db.get(ImportJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in ("queued", "running"):
        raise HTTPException(status_code=409, detail=f"Job already {job.status}")

    job.cancel_requested = True

    # Brutal termination: kill the Celery task process immediately so the
    # scraper / Gemini loop stops in-flight instead of waiting for the next
    # cooperative checkpoint.
    if job.celery_task_id:
        try:
            from app.workers.celery_app import celery_app
            celery_app.control.revoke(
                job.celery_task_id,
                terminate=True,
                signal="SIGTERM",
            )
        except Exception as e:
            if job.error_log:
                try:
                    errs = json.loads(job.error_log)
                except Exception:
                    errs = [job.error_log]
            else:
                errs = []
            errs.append(f"revoke failed: {e}")
            job.error_log = json.dumps(errs)

    job.status = "cancelled"
    job.finished_at = utcnow()
    await db.commit()
    await db.refresh(job)
    return job
