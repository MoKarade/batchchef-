"""
Update Maxi store_location_id in the DB.
Usage: uv run python scripts/update_maxi_store_id.py <new_store_id>
"""
import asyncio
import sys


async def update(store_id: str):
    from sqlalchemy import select
    from app.database import AsyncSessionLocal, init_db
    from app.models.store import Store

    await init_db()

    async with AsyncSessionLocal() as db:
        store = (await db.execute(select(Store).where(Store.code == "maxi"))).scalar_one_or_none()
        if not store:
            print("❌ Maxi store row not found in DB — run the API once to seed it first.")
            return

        old_id = store.store_location_id
        store.store_location_id = store_id
        await db.commit()
        print(f"✅ Maxi store_location_id updated: {old_id!r} → {store_id!r}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: uv run python scripts/update_maxi_store_id.py <new_store_id>")
        sys.exit(1)
    asyncio.run(update(sys.argv[1]))
