import os
from pathlib import Path
from dotenv import dotenv_values
from pydantic_settings import BaseSettings, SettingsConfigDict

# Windows sometimes sets system-wide env vars to empty strings, which would
# silently override .env. Backfill from .env when the OS var is missing/empty.
_env_file = Path(__file__).resolve().parent.parent / ".env"
if _env_file.exists():
    for k, v in dotenv_values(_env_file).items():
        if v and not os.environ.get(k):
            os.environ[k] = v


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "sqlite+aiosqlite:///./batchchef.db"
    REDIS_URL: str = "redis://localhost:6379/0"
    # Gemini is the primary AI provider. Claude kept as optional fallback.
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3-flash-preview"
    GEMINI_MODEL_FALLBACK: str = "gemini-3.1-flash-lite-preview"
    # Gemini free tier ~10 RPM → ~6s between calls. Set to 0 on paid tier.
    GEMINI_MIN_INTERVAL_S: float = 6.0
    AI_PROVIDER: str = "gemini"
    ANTHROPIC_API_KEY: str = ""
    CLAUDE_MODEL: str = "claude-haiku-4-5-20251001"
    CLAUDE_MIN_INTERVAL_S: float = 12.5
    SECRET_KEY: str = "batchchef-secret-change-in-prod-2026"
    ADMIN_EMAIL: str = "admin@batchchef.com"
    ADMIN_PASSWORD: str = ""
    UPLOADS_DIR: str = "../uploads"
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:3001"]
    HOST: str = "0.0.0.0"

    PLAYWRIGHT_HEADLESS: bool = True
    MAXI_STORE_ID: str = "8676"
    MAXI_POSTAL_CODE: str = "G1M 3E5"  # Fleur-de-Lys, Québec
    SCRAPE_CONCURRENCY: int = 5
    SCRAPE_RETRIES: int = 3
    PRICE_STALE_DAYS: int = 14


settings = Settings()
