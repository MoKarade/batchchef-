from celery import Celery
from celery.schedules import crontab
from celery.signals import worker_init, worker_shutting_down
from app.config import settings
from app.utils.shutdown import install_signal_handler, request_shutdown


@worker_init.connect
def _on_worker_init(**_kw):
    """Cooperate with Celery signals — when the worker spawns, wire up
    our SIGTERM/SIGINT handler. Lets long-running tasks see the shutdown
    flag and finish their current batch instead of being killed mid-commit."""
    install_signal_handler()


@worker_shutting_down.connect
def _on_worker_shutting_down(**_kw):
    request_shutdown()

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
        "app.workers.maxi_cart",
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
    # Visibility timeout — how long Redis keeps an unacked task before
    # making it visible to another worker. 12h so a running import is
    # never duplicate-picked by a second worker (we saw this happen when
    # job #78 got grabbed twice).
    #
    # Retry behavior (item #17): kept at the per-task decorator level
    # instead of task_annotations here. The "*" glob with a tuple-typed
    # ``autoretry_for`` broke Celery's task registration — tasks weren't
    # discoverable by the worker despite the module being imported, so
    # .delay() calls went to the queue but were never picked up. If we
    # want blanket retry later, each @celery_app.task can add
    # ``autoretry_for=(Exception,), max_retries=3, retry_backoff=True``
    # directly.
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
