from datetime import datetime
from pydantic import BaseModel, ConfigDict


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    job_type: str
    status: str
    progress_current: int
    progress_total: int
    current_item: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error_log: str | None = None
    celery_task_id: str | None = None
    cancel_requested: bool = False
    created_at: datetime


class ImportStartRequest(BaseModel):
    limit: int | None = None  # None = all 43k URLs
