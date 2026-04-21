from datetime import datetime
from sqlalchemy import Integer, String, DateTime, Text, Boolean, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class ImportJob(Base):
    __tablename__ = "import_job"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_type: Mapped[str] = mapped_column(String, nullable=False)  # marmiton_bulk|price_refresh|ai_reprocess
    status: Mapped[str] = mapped_column(String, default="queued")  # queued|running|completed|failed|cancelled
    progress_current: Mapped[int] = mapped_column(Integer, default=0)
    progress_total: Mapped[int] = mapped_column(Integer, default=0)
    current_item: Mapped[str | None] = mapped_column(String)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
    error_log: Mapped[str | None] = mapped_column(Text)  # JSON list of errors
    celery_task_id: Mapped[str | None] = mapped_column(String)
    metadata_json: Mapped[str | None] = mapped_column(Text)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
