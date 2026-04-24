from celery import Celery
from celery.schedules import crontab
from app.config import settings

celery_app = Celery(
    "batchchef",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=[
        "app.workers.import_marmiton",
        "app.workers.continuous_import",
        "app.workers.map_prices",
        "app.workers.classify_recipes",
        "app.workers.process_receipt",
        "app.workers.zombie_cleanup",
        "app.workers.db_backup",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="America/Toronto",
    enable_utc=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    # ── Retry & reliability defaults (item #17) ──────────────────────────
    # Tasks that raise an unexpected exception are requeued with an
    # exponential backoff: 60s → 120s → 240s, capped at 3 attempts. Each
    # concrete task can override via its own decorator kwargs.
    task_annotations={
        "*": {
            "autoretry_for": (Exception,),
            "retry_backoff": 60,
            "retry_backoff_max": 600,
            "retry_jitter": True,
            "max_retries": 3,
        },
        # Long-running scrapers: increase max_retries only when appropriate.
        # The import_marmiton and map_prices tasks have their own inner
        # retry loops around Playwright; we keep the outer retry low so we
        # don't re-run a 20k-URL job from scratch on a transient error.
        "import_marmiton.run": {"max_retries": 1},
        "prices.map": {"max_retries": 1},
    },
    # Visibility timeout — how long Redis keeps an unacked task before
    # making it visible to another worker. Must be >= longest task; we
    # default to 12h so a running import is never duplicate-picked by a
    # second worker (we saw this happen when jobs #78 was grabbed twice).
    broker_transport_options={"visibility_timeout": 43_200},
)

celery_app.conf.beat_schedule = {
    "zombie-cleanup-hourly": {
        "task": "app.workers.zombie_cleanup.run_zombie_cleanup",
        "schedule": crontab(minute=0),
    },
    # DB backup (item #21) — nightly dump of batchchef.db at 03:17 local
    # (off-peak + not on the :00 mark to avoid cron congestion).
    "db-backup-nightly": {
        "task": "app.workers.db_backup.run_db_backup",
        "schedule": crontab(hour=3, minute=17),
    },
}
