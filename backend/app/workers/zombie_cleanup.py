"""
Celery beat task: marks jobs stuck in 'running'/'queued' as 'failed' after 4 hours.
Prevents orphaned job records from blocking the UI indefinitely.
"""
import asyncio
import json
import logging
from datetime import timedelta
from sqlalchemy import select
from app.workers.celery_app import celery_app
from app.utils.time import utcnow

logger = logging.getLogger(__name__)

ZOMBIE_TIMEOUT_HOURS = 4


@celery_app.task(name="app.workers.zombie_cleanup.run_zombie_cleanup", bind=True)
def run_zombie_cleanup(self):
    asyncio.run(_cleanup())


async def _cleanup():
    from app.database import AsyncSessionLocal
    from app.models.job import ImportJob

    cutoff = utcnow() - timedelta(hours=ZOMBIE_TIMEOUT_HOURS)
    async with AsyncSessionLocal() as db:
        q = select(ImportJob).where(
            ImportJob.status.in_(["running", "queued"]),
            ImportJob.created_at < cutoff,
        )
        stuck_jobs = list((await db.execute(q)).scalars().all())

        for job in stuck_jobs:
            logger.warning("Marking zombie job %s (%s) as failed", job.id, job.job_type)
            job.status = "failed"
            job.finished_at = utcnow()
            errs = []
            try:
                errs = json.loads(job.error_log or "[]")
            except Exception:
                pass
            errs.append(f"Zombie cleanup: job stuck for >{ZOMBIE_TIMEOUT_HOURS}h")
            job.error_log = json.dumps(errs)

        if stuck_jobs:
            await db.commit()
            logger.info("Zombie cleanup: marked %d jobs as failed", len(stuck_jobs))
