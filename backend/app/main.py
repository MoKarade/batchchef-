import logging
import shutil
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.config import settings
from app.database import init_db
from app.routers import recipes, imports, batches, inventory, receipts, stores, ws, ingredients, auth, chef, meal_plans, stats_personal
from app.utils.time import utcnow

logger = logging.getLogger(__name__)


def _bootstrap_db_from_seed():
    """If no batchchef.db exists but a committed snapshot batchchef.seed.db is
    present (fresh `git clone`), copy it so a new machine gets every
    imported recipe / scraped price / OpenFoodFacts nutrition hit for free."""
    cwd = Path.cwd()
    db_path = cwd / "batchchef.db"
    seed_path = cwd / "batchchef.seed.db"
    if not db_path.exists() and seed_path.exists():
        shutil.copy(seed_path, db_path)
        logger.warning(
            f"Bootstrapped batchchef.db from committed snapshot "
            f"({seed_path.stat().st_size / 1_048_576:.1f} MB). "
            "Delete batchchef.db and restart to reset, or edit .env to point elsewhere."
        )


async def _cleanup_zombie_jobs() -> None:
    """Mark jobs stuck in running/queued as failed on startup (Celery may have died mid-task)."""
    from datetime import timedelta
    from sqlalchemy import update
    from app.database import AsyncSessionLocal
    from app.models.job import ImportJob

    cutoff = utcnow() - timedelta(minutes=5)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            update(ImportJob)
            .where(ImportJob.status.in_(["running", "queued"]), ImportJob.created_at < cutoff)
            .values(
                status="failed",
                finished_at=utcnow(),
                error_log='["Zombie cleanup: server restarted while job was running"]',
            )
        )
        await db.commit()
        if result.rowcount:
            logger.warning("Startup zombie cleanup: marked %d stuck jobs as failed", result.rowcount)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Security first: generate SECRET_KEY if the user hasn't set one. Run
    # BEFORE anything that might mint a JWT (which happens in _seed_admin_user).
    from app.utils.crypto import ensure_secret_key
    ensure_secret_key()

    _bootstrap_db_from_seed()
    await init_db()
    await _cleanup_zombie_jobs()
    await _seed_stores()
    await _seed_admin_user()
    yield


app = FastAPI(
    title="BatchChef API",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global error handler — item #18. Before this, bare ``except Exception``
# in routers like receipts.py and chef.py would swallow errors silently.
# Now every unhandled exception is logged with stack + request path, and
# the client gets a stable ``{error, code, request_id}`` shape.
import uuid
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    request_id = str(uuid.uuid4())[:8]
    logger.exception(
        "Unhandled exception [%s] %s %s",
        request_id, request.method, request.url.path,
    )
    # Also stash in the in-process ring buffer so the /api/admin/errors
    # endpoint can surface it for post-mortem debugging.
    try:
        from app.utils.error_buffer import record_exception
        record_exception(exc, request_id=request_id, method=request.method, path=request.url.path)
    except Exception:
        pass  # never let error-recording itself crash the handler
    return JSONResponse(
        status_code=500,
        content={
            "error": "internal_server_error",
            "message": "Une erreur inattendue est survenue. Le problème a été loggé.",
            "request_id": request_id,
        },
    )


@app.exception_handler(RequestValidationError)
async def _validation_error_handler(request: Request, exc: RequestValidationError):
    # Keep FastAPI's default 422 body but wrap it in our stable shape
    return JSONResponse(
        status_code=422,
        content={
            "error": "validation_error",
            "message": "Paramètres de requête invalides.",
            "details": exc.errors(),
        },
    )

# API routes
app.include_router(recipes.router)
app.include_router(imports.router)
app.include_router(batches.router)
app.include_router(inventory.router)
app.include_router(receipts.router)
app.include_router(stores.router)
app.include_router(ingredients.router)
app.include_router(auth.router)
app.include_router(chef.router)
app.include_router(meal_plans.router)
app.include_router(stats_personal.router)
app.include_router(ws.router)

# Serve uploaded files
uploads_dir = Path(settings.UPLOADS_DIR)
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")


@app.get("/api/health")
async def health():
    """Enriched health check — used by monitoring dashboards and the
    settings page. Surfaces Redis availability, Celery worker count, DB
    size, and the last successful import."""
    import os
    from datetime import datetime, timedelta, timezone
    from sqlalchemy import select, func
    from app.database import AsyncSessionLocal
    from app.models.job import ImportJob

    status_out: dict = {"status": "healthy", "version": "2.0.0"}

    # Redis — we swallow exceptions so the health endpoint itself never 500s
    try:
        import redis
        r = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=1)
        r.ping()
        status_out["redis"] = {"up": True, "queue_depth": r.llen("celery")}
    except Exception as e:
        status_out["redis"] = {"up": False, "error": str(e)[:80]}

    # Celery workers — inspect the broker for registered hostnames
    try:
        from app.workers.celery_app import celery_app
        insp = celery_app.control.inspect(timeout=1.0)
        active = insp.active() or {}
        status_out["celery"] = {
            "workers": list(active.keys()),
            "worker_count": len(active),
        }
    except Exception as e:
        status_out["celery"] = {"worker_count": 0, "error": str(e)[:80]}

    # DB size + last import
    try:
        db_path = settings.DATABASE_URL.split("///")[-1]
        if os.path.exists(db_path):
            status_out["db"] = {
                "size_mb": round(os.path.getsize(db_path) / 1_048_576, 1),
                "path": db_path,
            }
        async with AsyncSessionLocal() as db:
            last = (
                await db.execute(
                    select(ImportJob)
                    .where(ImportJob.status == "completed")
                    .order_by(ImportJob.finished_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if last:
                status_out["last_successful_import"] = {
                    "id": last.id,
                    "type": last.job_type,
                    "finished_at": last.finished_at.isoformat() if last.finished_at else None,
                }
            # Active jobs counter
            count_active = await db.execute(
                select(func.count(ImportJob.id)).where(
                    ImportJob.status.in_(["running", "queued"])
                )
            )
            status_out["active_jobs"] = count_active.scalar_one()
    except Exception as e:
        status_out["db_error"] = str(e)[:80]

    return status_out


@app.get("/api/metrics")
async def metrics():
    """Lightweight JSON metrics endpoint for monitoring dashboards.

    Not Prometheus-format (yet) — just a flat dict anyone can scrape.
    Cached 30s in Redis via the existing @cached utility so a polling
    dashboard doesn't hammer the DB.
    """
    from app.utils.cache import cached
    from datetime import datetime, timedelta, timezone

    @cached("metrics", ttl=30)
    async def _compute():
        from sqlalchemy import select, func
        from app.database import AsyncSessionLocal
        from app.models.recipe import Recipe
        from app.models.ingredient import IngredientMaster
        from app.models.store import StoreProduct
        from app.models.batch import Batch, ShoppingListItem
        from app.models.job import ImportJob

        async with AsyncSessionLocal() as db:
            recipes_total = (await db.execute(select(func.count(Recipe.id)))).scalar_one()
            recipes_by_status = dict(
                (await db.execute(
                    select(Recipe.status, func.count(Recipe.id)).group_by(Recipe.status)
                )).all()
            )
            ings_total = (await db.execute(select(func.count(IngredientMaster.id)))).scalar_one()
            ings_by_status = dict(
                (await db.execute(
                    select(IngredientMaster.price_mapping_status, func.count(IngredientMaster.id))
                    .where(IngredientMaster.parent_id.is_(None))
                    .group_by(IngredientMaster.price_mapping_status)
                )).all()
            )
            store_products = (await db.execute(
                select(func.count(StoreProduct.id)).where(StoreProduct.is_validated == True)  # noqa: E712
            )).scalar_one()
            batches_total = (await db.execute(select(func.count(Batch.id)))).scalar_one()
            jobs_24h = (await db.execute(
                select(ImportJob.job_type, ImportJob.status, func.count(ImportJob.id))
                .where(ImportJob.created_at >= utcnow() - timedelta(hours=24))
                .group_by(ImportJob.job_type, ImportJob.status)
            )).all()
            shopping_items = (await db.execute(
                select(func.count(ShoppingListItem.id))
            )).scalar_one()

        jobs_24h_dict: dict[str, dict[str, int]] = {}
        for job_type, status, cnt in jobs_24h:
            jobs_24h_dict.setdefault(job_type, {})[status] = cnt

        # Circuit breaker states — tells you at a glance which external
        # dependencies are happy vs throttling. Not cached (changes per-call).
        from app.utils.circuit_breaker import snapshot as breakers_snapshot
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "recipes": {
                "total": recipes_total,
                "by_status": recipes_by_status,
            },
            "ingredients": {
                "total": ings_total,
                "parents_by_mapping_status": ings_by_status,
            },
            "store_products_validated": store_products,
            "batches_total": batches_total,
            "shopping_items_total": shopping_items,
            "jobs_last_24h": jobs_24h_dict,
            "circuit_breakers": breakers_snapshot(),
        }

    return await _compute()


@app.get("/api/admin/errors")
async def admin_errors(limit: int = 50):
    """Last N unhandled exceptions captured by the global error handler.
    No auth guard — single-user local deployment. Wrap in a real auth
    check before deploying publicly."""
    from app.utils.error_buffer import snapshot as errors_snapshot
    return {"errors": errors_snapshot(limit=max(1, min(limit, 200)))}


@app.post("/api/admin/errors/clear")
async def admin_errors_clear():
    from app.utils.error_buffer import clear as errors_clear
    return {"cleared": errors_clear()}


@app.get("/api/stats")
async def stats():
    """Top-level dashboard stats. Cached 60s in Redis — this is hit on every
    Dashboard mount and any refresh interval cascades, so caching saves
    ~4 COUNT queries per request (item #40)."""
    from app.utils.cache import cached

    @cached("stats", ttl=60)
    async def _compute():
        from sqlalchemy import select, func
        from app.database import AsyncSessionLocal
        from app.models.recipe import Recipe
        from app.models.ingredient import IngredientMaster
        from app.models.store import StoreProduct

        async with AsyncSessionLocal() as db:
            total_recipes = (await db.execute(select(func.count(Recipe.id)))).scalar_one()
            ai_done = (await db.execute(
                select(func.count(Recipe.id)).where(Recipe.status == "ai_done")
            )).scalar_one()
            total_ingredients = (await db.execute(select(func.count(IngredientMaster.id)))).scalar_one()
            priced = (await db.execute(
                select(func.count(StoreProduct.id)).where(StoreProduct.is_validated == True)  # noqa: E712
            )).scalar_one()

        return {
            "total_recipes": total_recipes,
            "ai_done_recipes": ai_done,
            "total_ingredients": total_ingredients,
            "priced_ingredients": priced,
        }

    return await _compute()


async def _seed_stores():
    """Ensure the base stores exist on startup.

    V3: Maxi primary (DOM scraper) + Costco secondary (sitemap + GraphQL).
    Fruiterie 440 rows from prior installs stay untouched; no code uses them.
    """
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models.store import Store

    STORES = [
        {"code": "maxi", "name": "Maxi", "type": "supermarket",
         "website_url": "https://www.maxi.ca", "store_location_id": settings.MAXI_STORE_ID,
         "is_transactional": True},
        {"code": "costco", "name": "Costco", "type": "supermarket",
         "website_url": "https://www.costco.ca", "store_location_id": "894",  # Québec warehouse
         "is_transactional": True},
    ]

    async with AsyncSessionLocal() as db:
        added = 0
        for s in STORES:
            exists = (await db.execute(select(Store).where(Store.code == s["code"]))).scalar_one_or_none()
            if not exists:
                db.add(Store(**s))
                added += 1
            else:
                exists.store_location_id = s["store_location_id"]
                exists.website_url = s.get("website_url")
        await db.commit()
        if added:
            logger.info("Seeded %d new store(s)", added)


async def _seed_admin_user():
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models.user import User
    from app.auth import hash_password, verify_password

    email = settings.ADMIN_EMAIL
    password = settings.ADMIN_PASSWORD
    if not email or not password:
        return

    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            db.add(User(
                email=email,
                hashed_password=hash_password(password),
                display_name="Admin",
                is_active=True,
                is_admin=True,
            ))
            await db.commit()
            logger.info("Seeded admin user %s", email)
        elif not verify_password(password, user.hashed_password):
            user.hashed_password = hash_password(password)
            await db.commit()
            logger.info("Updated admin password for %s", email)
