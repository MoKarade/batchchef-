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
)

celery_app.conf.beat_schedule = {
    "zombie-cleanup-hourly": {
        "task": "app.workers.zombie_cleanup.run_zombie_cleanup",
        "schedule": crontab(minute=0),
    },
}
