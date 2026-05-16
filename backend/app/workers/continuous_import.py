"""Continuous Marmiton import — loops marmiton_bulk until URL pool is empty.

Launched as a single Celery task that internally dispatches batches of ~500
URLs at a time, waiting for each batch to finish before queuing the next.
Reports live progress via the standard ImportJob row.
"""
import asyncio
import logging
from sqlalchemy import select, func

from app.workers.celery_app import celery_app
from app.utils.time import utcnow

logger = logging.getLogger(__name__)

BATCH_SIZE = 100
SLEEP_BETWEEN = 30  # seconds to give the worker some slack


@celery_app.task(name="imports.continuous", bind=True)
def run_continuous_import(self, job_id: int):
    asyncio.run(_run(job_id))


async def _run(job_id: int):
    """Loop until cleaned_recipes.txt URL pool has been fully consumed.

    Each iteration:
      1. Reads the source URL file.
      2. Subtracts URLs already imported (matched on Recipe.marmiton_url).
      3. Dispatches a marmiton_bulk Celery task for the next BATCH_SIZE URLs.
      4. Polls its status until it finishes, then sleeps SLEEP_BETWEEN and loops.
    """
    from pathlib import Path
    from app.database import AsyncSessionLocal, init_db
    from app.models.job import ImportJob
    from app.models.recipe import Recipe
    from app.workers.import_marmiton import run_marmiton_import

    await init_db()

    data_dir = Path(__file__).parent.parent.parent.parent / "data"
    urls_file = data_dir / "cleaned_recipes.txt"
    if not urls_file.exists():
        async with AsyncSessionLocal() as db:
            job = await db.get(ImportJob, job_id)
            if job:
                job.status = "failed"
                job.error_log = '["cleaned_recipes.txt not found"]'
                await db.commit()
        return

    all_urls = [u.strip() for u in urls_file.read_text(encoding="utf-8").splitlines() if u.strip().startswith("http")]

    while True:
        async with AsyncSessionLocal() as db:
            job = await db.get(ImportJob, job_id)
            if not job or job.cancel_requested:
                return

            already = set(
                u for (u,) in (await db.execute(select(Recipe.marmiton_url))).all()
            )
            remaining_urls = [u for u in all_urls if u not in already]
            total_imported = len(already)
            remaining = len(remaining_urls)

            job.progress_total = len(all_urls)
            job.progress_current = total_imported
            job.current_item = f"Continu · reste {remaining} URLs"
            await db.commit()

        if remaining <= 0:
            async with AsyncSessionLocal() as db:
                job = await db.get(ImportJob, job_id)
                if job:
                    job.status = "completed"
                    job.finished_at = utcnow()
                    await db.commit()
            logger.info("[continuous_import] done — URL queue empty")
            return

        batch = remaining_urls[:BATCH_SIZE]
        logger.info(
            f"[continuous_import] firing batch of {len(batch)} urls ({remaining} left)"
        )

        # Fire a one-off marmiton_bulk child job and wait for it.
        async with AsyncSessionLocal() as db:
            child = ImportJob(
                job_type="marmiton_bulk",
                status="queued",
                progress_total=len(batch),
            )
            db.add(child)
            await db.flush()
            await db.refresh(child)
            child_id = child.id
            await db.commit()

        try:
            task = run_marmiton_import.delay(child_id, batch)
            # Poll until child finishes (or our own job is cancelled)
            while True:
                await asyncio.sleep(10)
                async with AsyncSessionLocal() as db:
                    parent = await db.get(ImportJob, job_id)
                    if parent and parent.cancel_requested:
                        task.revoke(terminate=True)
                        return
                    c = await db.get(ImportJob, child_id)
                    if c and c.status in ("completed", "failed", "cancelled"):
                        break
        except Exception as e:
            logger.warning(f"[continuous_import] batch failed: {e}")

        await asyncio.sleep(SLEEP_BETWEEN)
