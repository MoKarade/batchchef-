from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "sqlite+aiosqlite:///./batchchef.db"
    REDIS_URL: str = "redis://localhost:6379/0"
    ANTHROPIC_API_KEY: str
    CLAUDE_MODEL: str = "claude-haiku-4-5-20251001"
    # Min seconds between Claude calls. Free tier = 5 RPM → ~12.5s. Set to 0 on paid tier.
    CLAUDE_MIN_INTERVAL_S: float = 12.5
    # Deprecated, kept optional for backward-compat with existing .env files
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = ""
    SECRET_KEY: str = "batchchef-secret-change-in-prod-2026"
    UPLOADS_DIR: str = "../uploads"
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:3001"]
    HOST: str = "0.0.0.0"

    PLAYWRIGHT_HEADLESS: bool = True
    MAXI_STORE_ID: str = "7234"
    MAXI_POSTAL_CODE: str = "G1M 3E5"  # Fleur-de-Lys, Québec
    COSTCO_ENABLED: bool = True
    COSTCO_POSTAL_CODE: str = "G2J 1E3"  # 440 Rue Bouvier, Québec
    # Costco names this warehouse "Quebec" (not "Bouvier" — that's the street).
    # Still, we mostly rely on proximity ordering: the first result for the
    # postal code is always the nearest warehouse.
    COSTCO_WAREHOUSE_NAME_HINT: str = "Quebec"
    SCRAPE_CONCURRENCY: int = 5
    SCRAPE_RETRIES: int = 3
    PRICE_STALE_DAYS: int = 14


settings = Settings()
