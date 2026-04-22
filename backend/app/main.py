from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.config import settings
from app.database import init_db
from app.routers import recipes, imports, batches, inventory, receipts, stores, ws, ingredients, auth, admin


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
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

# API routes
app.include_router(recipes.router)
app.include_router(imports.router)
app.include_router(batches.router)
app.include_router(inventory.router)
app.include_router(receipts.router)
app.include_router(stores.router)
app.include_router(ingredients.router)
app.include_router(admin.router)
app.include_router(auth.router)
app.include_router(ws.router)

# Serve uploaded files
uploads_dir = Path(settings.UPLOADS_DIR)
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")


@app.get("/api/health")
async def health():
    return {"status": "healthy", "version": "2.0.0"}


@app.get("/api/stats")
async def stats():
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


async def _seed_stores():
    """Ensure the 3 base stores exist on startup."""
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models.store import Store

    STORES = [
        {"code": "maxi", "name": "Maxi", "type": "supermarket",
         "website_url": "https://www.maxi.ca", "store_location_id": settings.MAXI_STORE_ID,
         "is_transactional": True},
        {"code": "costco", "name": "Costco", "type": "supermarket",
         "website_url": "https://www.costco.ca", "store_location_id": "503",
         "is_transactional": True},
        {"code": "fruiterie_440", "name": "Fruiterie 440", "type": "fruiterie",
         "website_url": None, "store_location_id": None,
         "is_transactional": False},
    ]

    async with AsyncSessionLocal() as db:
        for s in STORES:
            exists = (await db.execute(select(Store).where(Store.code == s["code"]))).scalar_one_or_none()
            if not exists:
                db.add(Store(**s))
            else:
                # Update mutable fields so .env changes take effect on restart
                exists.store_location_id = s["store_location_id"]
                exists.website_url = s.get("website_url")
        await db.commit()


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
        elif not verify_password(password, user.hashed_password):
            user.hashed_password = hash_password(password)
            await db.commit()
