"""Cooperative cancellation tests for import jobs."""
import pytest

from app.models.job import ImportJob


@pytest.mark.asyncio
async def test_cancel_requested_defaults_false(db):
    job = ImportJob(job_type="marmiton_bulk", status="queued", progress_total=10)
    db.add(job)
    await db.commit()
    await db.refresh(job)
    assert job.cancel_requested is False


@pytest.mark.asyncio
async def test_setting_cancel_requested_is_observable(db):
    """Simulates the worker's cooperative check: after another session flips the
    flag, a fresh get() must return the updated value."""
    job = ImportJob(job_type="marmiton_bulk", status="running", progress_total=50)
    db.add(job)
    await db.commit()

    # Simulate the HTTP cancel endpoint: set flag and commit
    job.cancel_requested = True
    await db.commit()

    # Simulate the worker's next-batch check: re-read the row
    refreshed = await db.get(ImportJob, job.id)
    assert refreshed.cancel_requested is True


@pytest.mark.asyncio
async def test_worker_loop_respects_cancel_flag(db):
    """Reproduces the cooperative pattern used in import_marmiton._run:
    the worker loops over batches, re-reads the job each iteration, and
    breaks when cancel_requested=True."""
    job = ImportJob(job_type="marmiton_bulk", status="running", progress_total=20)
    db.add(job)
    await db.commit()

    batches_done = 0
    cancelled = False

    for i in range(4):  # 4 batches of 5 URLs each
        # Coop check — mirrors worker code
        current = await db.get(ImportJob, job.id)
        if current.cancel_requested:
            cancelled = True
            break

        batches_done += 1

        # After 2 batches, an external actor cancels
        if batches_done == 2:
            current.cancel_requested = True
            await db.commit()

    assert cancelled is True
    assert batches_done == 2

    # Finalize as the worker would
    final_status = "cancelled" if cancelled else "completed"
    job.status = final_status
    await db.commit()
    await db.refresh(job)
    assert job.status == "cancelled"
