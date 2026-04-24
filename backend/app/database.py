from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)


# WAL mode + pragmas for multi-worker SQLite access. Without these, a long-
# running Celery task holds a write-lock that blocks every FastAPI request
# (we saw this: uvicorn --reload couldn't even start while price_mapping
# workers held exclusive locks).
#
#   journal_mode=WAL   — readers never block writers, writers never block readers
#   synchronous=NORMAL — good durability, ~5× faster commits vs. FULL
#   busy_timeout=5000  — instead of instant "database is locked", wait up to 5s
#   foreign_keys=ON    — SQLite doesn't enforce them by default (!)
@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, _connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db():
    async with engine.begin() as conn:
        from app.models import __all_models__  # noqa: F401 — ensure models are registered
        await conn.run_sync(Base.metadata.create_all)
        # Lightweight migrations for columns added after the initial schema
        # landed. Alembic is the proper long-term answer (item #38) but
        # these one-off ADD COLUMNs keep upgrades painless in the meantime.
        await _add_missing_columns(conn)


async def _add_missing_columns(conn):
    """Idempotent ``ALTER TABLE ... ADD COLUMN`` for schema drift.

    Each entry is ``(table, column, ddl)``. SQLite silently ignores an ADD
    COLUMN for a column that already exists in PostgreSQL but NOT in
    SQLite — so we check PRAGMA first. No-op if everything is up to date.
    """
    from sqlalchemy import text

    migrations = [
        # ingredient_master.usage_count — denormalized counter added to kill
        # the price-mapping init self-join that was taking >10 min.
        ("ingredient_master", "usage_count", "INTEGER DEFAULT 0 NOT NULL"),
        # recipe.user_notes + recipe.is_favorite — user annotations.
        ("recipe", "user_notes", "TEXT"),
        ("recipe", "is_favorite", "INTEGER DEFAULT 0 NOT NULL"),
    ]
    for table, col, ddl in migrations:
        existing = await conn.execute(text(f"PRAGMA table_info({table})"))
        cols = {row[1] for row in existing.fetchall()}
        if col not in cols:
            await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
