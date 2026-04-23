#!/usr/bin/env python3
"""Hot-backup the live SQLite DB → commit → push.

Designed to run on a timer (Windows Task Scheduler, cron, Celery beat…) so
a clone on any other machine always gets a recent snapshot via `git pull`.

Safe to run while the backend + Celery are actively writing to the DB
(uses SQLite's online .backup API which is lock-aware).

Exit codes:
  0  ok (pushed or no changes)
  1  git error
  2  db error
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
DB = REPO / "backend" / "batchchef.db"
SEED = REPO / "backend" / "batchchef.seed.db"
TMP = REPO / "backend" / f"batchchef.seed.{int(time.time())}.tmp.db"


def log(msg: str) -> None:
    print(f"[snapshot_db] {msg}", flush=True)


def hot_backup() -> None:
    """SQLite online backup: safe during concurrent writes."""
    if not DB.exists():
        log(f"{DB} not found — nothing to snapshot")
        sys.exit(2)
    src = sqlite3.connect(str(DB))
    dst = sqlite3.connect(str(TMP))
    try:
        src.backup(dst)
    finally:
        src.close()
        dst.close()
    # Atomic swap so partial writes aren't visible to git add
    if SEED.exists():
        SEED.unlink()
    shutil.move(str(TMP), str(SEED))
    log(f"hot backup OK ({SEED.stat().st_size / 1_048_576:.1f} MB)")


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(REPO), *args],
        check=check,
        capture_output=True,
        text=True,
    )


def fetch_stats() -> str:
    """Build a commit message from /api/stats if the API is up."""
    default = "Auto-snapshot"
    try:
        r = urllib.request.urlopen("http://localhost:8000/api/stats", timeout=4)
        s = json.loads(r.read())
        return (
            f"Auto-snapshot: {s['total_recipes']} recipes, "
            f"{s['priced_ingredients']} priced ({s['total_ingredients']} total ingredients)"
        )
    except Exception as e:  # noqa: BLE001
        log(f"stats unavailable ({e}), using default commit message")
        return default


def main() -> int:
    try:
        hot_backup()
    except Exception as e:  # noqa: BLE001
        log(f"backup failed: {e}")
        return 2

    # git add — only commit if the seed actually changed
    git("add", "backend/batchchef.seed.db", check=False)
    changed = git("diff", "--cached", "--quiet", check=False).returncode != 0
    if not changed:
        log("seed unchanged, nothing to push")
        return 0

    msg = fetch_stats()
    try:
        git("commit", "-m", msg)
    except subprocess.CalledProcessError as e:
        log(f"commit failed: {e.stderr}")
        return 1

    try:
        git("push", "origin", "HEAD")
    except subprocess.CalledProcessError as e:
        log(f"push failed: {e.stderr} — commit stays local, will retry next run")
        return 1

    log(f"pushed: {msg}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
