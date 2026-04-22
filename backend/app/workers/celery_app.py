from celery import Celery
from celery.schedules import crontab
from app.config import settings

celery_app = Celery(
    "batchchef",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=[
        "app.workers.import_marmiton",
        "app.workers.process_receipt",
        "app.workers.map_prices",
        "app.workers.validate_prices",
        "app.workers.estimate_fruiterie_prices",
        "app.workers.clean_display_names",
        "app.workers.classify_recipes",
        "app.workers.retry_missing_prices",
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
    "validate-prices-weekly": {
        "task": "app.workers.validate_prices.run_price_validation",
        "schedule": crontab(hour=3, minute=0, day_of_week=1),  # Monday 03:00
    },
    "retry-missing-prices-daily": {
        "task": "prices.retry_missing",
        "schedule": crontab(hour=3, minute=30),  # daily 03:30
    },
    "zombie-cleanup-hourly": {
        "task": "app.workers.zombie_cleanup.run_zombie_cleanup",
        "schedule": crontab(minute=0),  # every hour
    },
}
