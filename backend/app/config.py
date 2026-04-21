from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "sqlite+aiosqlite:///./batchchef.db"
    REDIS_URL: str = "redis://localhost:6379/0"
    GEMINI_API_KEY: str
    GEMINI_MODEL: str = "gemini-2.0-flash-exp"
    SECRET_KEY: str = "batchchef-secret-change-in-prod-2026"
    UPLOADS_DIR: str = "../uploads"
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:3001"]
    HOST: str = "0.0.0.0"

    PLAYWRIGHT_HEADLESS: bool = True
    MAXI_STORE_ID: str = "8676"
    COSTCO_ENABLED: bool = True
    SCRAPE_CONCURRENCY: int = 5
    SCRAPE_RETRIES: int = 3


settings = Settings()
