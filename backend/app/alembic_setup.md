# Alembic migrations — setup guide (item #38)

Status: **scaffolded, not yet active**. The auto-column-add shim in
`database.py::_add_missing_columns` still handles schema drift. This file
documents the migration path to Alembic for when we're ready.

## Why not switch now

The production SQLite already has 29k+ recipes, 20k+ ingredients, 240k
recipe-ingredient links. A botched first migration could lose that.
We ship Alembic only after:

1. The existing DB is fully backed up via the nightly `db_backup` worker
   (item #21 — already done, 7-day rolling).
2. We have a staging copy to dry-run the baseline migration on.

## Setup steps (when ready)

```bash
cd backend
uv add --dev alembic

uv run alembic init -t async migrations
```

Then edit `migrations/env.py`:

```python
from app.database import Base, engine
from app.models import __all_models__  # noqa  registers the metadata

target_metadata = Base.metadata
```

And `alembic.ini`:

```ini
sqlalchemy.url = sqlite+aiosqlite:///./batchchef.db
```

## Baseline migration

Generate the baseline against the CURRENT production schema (so the
existing tables are NOT rewritten):

```bash
uv run alembic revision --autogenerate -m "baseline — live schema as of YYYY-MM-DD"
uv run alembic stamp head  # mark the DB as up-to-date without running
```

## Ongoing

Every model change after that:

```bash
uv run alembic revision --autogenerate -m "add X column to Y"
uv run alembic upgrade head
```

## What to remove when active

Delete `_add_missing_columns()` from `app/database.py`. Its comment block
documents the three one-off migrations it replaced.
