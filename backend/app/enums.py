from enum import StrEnum


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class RecipeStatus(StrEnum):
    PENDING = "pending"
    SCRAPED = "scraped"
    AI_DONE = "ai_done"
    ERROR = "error"
