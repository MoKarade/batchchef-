"""Nightly SQLite backup — item #21.

Uses SQLite's online backup API (not a raw file copy, which would race
against the WAL writers). Keeps the last 7 dumps gzipped in ``backups/``.
Triggered by Celery Beat at 03:17 local (see celery_app.beat_schedule).
"""
from __future__ import annotations
import gzip
import logging
import os
import shutil
import sqlite3
from pathlib import Path

from app.workers.celery_app import celery_app
from app.config import settings
from app.utils.time import utcnow

logger = logging.getLogger(__name__)

BACKUP_DIR = Path("backups")
RETAIN = 7


def _resolve_db_path() -> Path:
    """Extract the on-disk DB path from the DATABASE_URL.

    Only SQLite is supported (the project explicitly uses aiosqlite)."""
    url = settings.DATABASE_URL
    if "sqlite" not in url:
        raise RuntimeError("db_backup only supports SQLite")
    # sqlite+aiosqlite:///./batchchef.db → ./batchchef.db
    return Path(url.split("///")[-1]).resolve()


@celery_app.task(name="db_backup.run", bind=True)
def run_db_backup(self):
    """One-shot backup + retention cleanup."""
    db_path = _resolve_db_path()
    if not db_path.exists():
        logger.warning("DB file not found for backup: %s", db_path)
        return {"skipped": True, "reason": "db_missing"}

    BACKUP_DIR.mkdir(exist_ok=True)
    stamp = utcnow().strftime("%Y-%m-%d_%H%M")
    target = BACKUP_DIR / f"batchchef-{stamp}.db"

    # SQLite's online backup API is the only safe way to snapshot a live DB
    # because it cooperates with the WAL writers. A raw ``shutil.copy`` can
    # capture a half-written page.
    src = sqlite3.connect(str(db_path))
    dst = sqlite3.connect(str(target))
    with dst:
        src.backup(dst)
    src.close()
    dst.close()

    # Gzip it — raw .db files are highly compressible (recipe text, URLs).
    gz_path = target.with_suffix(target.suffix + ".gz")
    with open(target, "rb") as fin, gzip.open(gz_path, "wb", compresslevel=6) as fout:
        shutil.copyfileobj(fin, fout)
    target.unlink()

    # Retention — keep the N most recent .db.gz
    dumps = sorted(BACKUP_DIR.glob("batchchef-*.db.gz"), key=os.path.getmtime, reverse=True)
    for old in dumps[RETAIN:]:
        try:
            old.unlink()
        except OSError:
            pass

    size_mb = round(gz_path.stat().st_size / 1_048_576, 2)
    logger.info("DB backup complete: %s (%.2f MB, keeping %d)",
                gz_path.name, size_mb, min(len(dumps), RETAIN))
    return {"file": str(gz_path), "size_mb": size_mb, "retained": min(len(dumps), RETAIN)}
