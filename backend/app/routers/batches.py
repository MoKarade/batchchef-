from app.utils.time import utcnow
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.database import get_db
from app.models.batch import Batch, BatchRecipe, ShoppingListItem
from app.schemas.batch import (
    BatchOut,
    BatchGenerateRequest,
    BatchPreviewOut,
    BatchAcceptRequest,
    BulkPurchaseRequest,
)
from app.services.batch_generator import (
    generate_batch,
    compute_batch_preview,
    persist_batch_from_slots,
)
from app.services.inventory_manager import settle_shopping_item

router = APIRouter(prefix="/api/batches", tags=["batches"])


@router.post("/generate", response_model=BatchOut, status_code=201)
async def generate(body: BatchGenerateRequest, db: AsyncSession = Depends(get_db)):
    try:
        batch = await generate_batch(
            db,
            target_portions=body.target_portions,
            exclude_ids=body.exclude_recipe_ids or [],
            num_recipes=body.num_recipes,
            meal_type_sequence=body.meal_type_sequence,
            vegetarian_only=body.vegetarian_only,
            vegan_only=body.vegan_only,
            max_cost_per_portion=body.max_cost_per_portion,
            prep_time_max_min=body.prep_time_max_min,
            health_score_min=body.health_score_min,
            include_recipe_ids=body.include_recipe_ids,
            prefer_inventory=body.prefer_inventory,
            include_ingredient_ids=body.include_ingredient_ids,
            exclude_ingredient_ids=body.exclude_ingredient_ids,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return batch


@router.post("/preview", response_model=BatchPreviewOut)
async def preview(body: BatchGenerateRequest, db: AsyncSession = Depends(get_db)):
    try:
        return await compute_batch_preview(
            db,
            target_portions=body.target_portions,
            exclude_ids=body.exclude_recipe_ids or [],
            num_recipes=body.num_recipes,
            meal_type_sequence=body.meal_type_sequence,
            vegetarian_only=body.vegetarian_only,
            vegan_only=body.vegan_only,
            max_cost_per_portion=body.max_cost_per_portion,
            prep_time_max_min=body.prep_time_max_min,
            health_score_min=body.health_score_min,
            include_recipe_ids=body.include_recipe_ids,
            prefer_inventory=body.prefer_inventory,
            include_ingredient_ids=body.include_ingredient_ids,
            exclude_ingredient_ids=body.exclude_ingredient_ids,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/accept", response_model=BatchOut, status_code=201)
async def accept(body: BatchAcceptRequest, db: AsyncSession = Depends(get_db)):
    from app.services.batch_generator import preview_for_recipes
    from app.models.recipe import Recipe
    from sqlalchemy.orm import selectinload
    from app.models.recipe import RecipeIngredient

    # Input validation (audit #13): refuse nonsensical portions upfront
    if body.target_portions <= 0:
        raise HTTPException(422, "target_portions must be > 0")
    for r in body.recipes:
        if r.portions <= 0:
            raise HTTPException(
                422, f"portions for recipe {r.recipe_id} must be > 0 (got {r.portions})",
            )

    # Gate: verify price coverage before persisting
    recipe_ids = [r.recipe_id for r in body.recipes]
    load_opts = selectinload(Recipe.ingredients).selectinload(RecipeIngredient.ingredient)
    q = select(Recipe).options(load_opts).where(Recipe.id.in_(recipe_ids))
    recipes = list((await db.execute(q)).scalars().all())
    slots = [(r.recipe_id, r.portions) for r in body.recipes]
    preview = await preview_for_recipes(db, body.target_portions, recipes)
    if preview.get("price_coverage", 1.0) < 1.0:
        missing = preview.get("unpriced_ingredients", [])
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INCOMPLETE_PRICING",
                "message": "Certains ingrédients n'ont pas de prix Maxi.",
                "unpriced_ingredients": missing,
                "price_coverage": preview["price_coverage"],
            },
        )

    try:
        return await persist_batch_from_slots(
            db,
            target_portions=body.target_portions,
            slots=slots,
            name=body.name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("", response_model=list[BatchOut])
async def list_batches(db: AsyncSession = Depends(get_db)):
    q = (
        select(Batch)
        .options(
            selectinload(Batch.batch_recipes).selectinload(BatchRecipe.recipe),
            selectinload(Batch.shopping_items).selectinload(ShoppingListItem.ingredient),
            selectinload(Batch.shopping_items).selectinload(ShoppingListItem.store),
            selectinload(Batch.shopping_items).selectinload(ShoppingListItem.store_product),
        )
        .order_by(Batch.id.desc())
        .limit(20)
    )
    return (await db.execute(q)).scalars().all()


@router.get("/{batch_id}", response_model=BatchOut)
async def get_batch(batch_id: int, db: AsyncSession = Depends(get_db)):
    q = (
        select(Batch)
        .options(
            selectinload(Batch.batch_recipes).selectinload(BatchRecipe.recipe),
            selectinload(Batch.shopping_items).selectinload(ShoppingListItem.ingredient),
            selectinload(Batch.shopping_items).selectinload(ShoppingListItem.store),
            selectinload(Batch.shopping_items).selectinload(ShoppingListItem.store_product),
        )
        .where(Batch.id == batch_id)
    )
    batch = (await db.execute(q)).scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    return batch


@router.delete("/{batch_id}", status_code=204)
async def delete_batch(batch_id: int, db: AsyncSession = Depends(get_db)):
    batch = await db.get(Batch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    await db.delete(batch)
    await db.commit()


class BatchMetadataPatch(BaseModel):
    """Partial update for Batch metadata. All fields optional — only those
    explicitly set via ``model_dump(exclude_unset=True)`` get written."""
    name: str | None = None
    notes: str | None = None
    status: str | None = None


@router.patch("/{batch_id}", response_model=BatchOut)
async def update_batch_metadata(
    batch_id: int,
    body: BatchMetadataPatch,
    db: AsyncSession = Depends(get_db),
):
    """Rename/relabel a batch, update notes, or force a status transition.

    ``notes`` = free-form multiline text shown in the detail page, used for
    "ajouter 10% plus de crème" / "trop épicé pour les kids" kind of
    per-batch annotations.
    """
    batch = await db.get(Batch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    patch = body.model_dump(exclude_unset=True)
    VALID_STATUSES = {"draft", "shopping", "cooking", "done"}
    if "status" in patch and patch["status"] not in VALID_STATUSES:
        raise HTTPException(400, f"status must be one of {sorted(VALID_STATUSES)}")

    for key, value in patch.items():
        setattr(batch, key, value)
    await db.commit()

    # Reload with relations for the response
    q = (
        select(Batch)
        .where(Batch.id == batch_id)
        .options(
            selectinload(Batch.batch_recipes),
            selectinload(Batch.shopping_items),
        )
    )
    return (await db.execute(q)).scalar_one()


@router.post("/{batch_id}/export-to-google-tasks")
async def export_to_google_tasks(
    batch_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Export the batch's shopping list as a new Google Tasks list on the
    connected user's Google account. Synchronous (no Celery) because the
    Tasks API is fast and we want to surface errors immediately to the UI.

    Each shopping item becomes one task; the product URL (when present)
    goes into the task notes so the Tasks mobile app shows a tappable link.
    Requires the user to have connected Google via /api/auth/google/oauth-start.
    """
    from app.models.batch import Batch, ShoppingListItem
    from app.models.ingredient import IngredientMaster
    from app.models.user import User
    from app.services.google_tasks import (
        create_task,
        create_tasklist,
        ensure_access_token,
    )
    from datetime import date as _date

    q = (
        select(Batch)
        .where(Batch.id == batch_id)
        .options(
            selectinload(Batch.shopping_items)
            .selectinload(ShoppingListItem.ingredient),
            selectinload(Batch.shopping_items).selectinload(ShoppingListItem.store),
        )
    )
    batch = (await db.execute(q)).scalar_one_or_none()
    if not batch:
        raise HTTPException(404, "Batch not found")

    # Pick user — same resolution as fill_maxi_cart
    user = None
    if batch.user_id is not None:
        user = await db.get(User, batch.user_id)
    if not user or not user.google_refresh_token_encrypted:
        q_user = select(User).where(User.google_refresh_token_encrypted.isnot(None)).limit(1)
        user = (await db.execute(q_user)).scalar_one_or_none()
    if not user or not user.google_refresh_token_encrypted:
        raise HTTPException(
            409,
            "Aucun compte Google connecté. Va dans /settings et clique « Connecter Google Tasks ».",
        )

    try:
        access_token = await ensure_access_token(user, db)
    except Exception as e:
        raise HTTPException(502, f"Token Google invalide : {e}")

    # Filter unpurchased items — the user's already-bought ones shouldn't
    # re-appear on their Tasks checklist.
    items = [it for it in batch.shopping_items if not it.is_purchased]
    if not items:
        raise HTTPException(400, "Tous les items sont déjà cochés comme achetés.")

    # Fail-fast sanity check: ping the Tasks API with a cheap call before
    # creating the list, so we don't end up with a half-populated list if
    # the token's revoked or the API is down (audit #6).
    import httpx as _httpx
    try:
        async with _httpx.AsyncClient(timeout=8.0) as _c:
            _r = await _c.get(
                "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"maxResults": 1},
            )
            _r.raise_for_status()
    except _httpx.HTTPStatusError as e:
        code = e.response.status_code if e.response else "?"
        raise HTTPException(502, f"Google Tasks API rejette notre token ({code}) — reconnecte dans /settings")
    except Exception as e:
        raise HTTPException(502, f"Google Tasks API unreachable: {e}")

    title = batch.name or f"Courses BatchChef — {batch.generated_at.date().isoformat()}"
    # Prefix makes it obvious in Tasks UI which list is ours
    title = f"🛒 {title}"

    try:
        list_id = await create_tasklist(access_token, title)
    except Exception as e:
        raise HTTPException(502, f"Création liste Tasks échouée : {e}")

    created = 0
    errors: list[str] = []
    for it in items:
        name = (
            it.ingredient.display_name_fr
            if it.ingredient
            else f"Ingrédient #{it.ingredient_master_id}"
        )
        # Build a compact human title:  "3 × 500 g · Farine blanche"
        qty_str = ""
        if it.format_qty and it.format_unit:
            qty_str = f"{it.packages_to_buy} × {it.format_qty}{it.format_unit} · "
        elif it.quantity_needed:
            qty_str = f"{it.quantity_needed:g} {it.unit} · "
        task_title = f"{qty_str}{name}".strip()

        # Notes: store + product URL (auto-linkified in Tasks)
        notes_parts: list[str] = []
        if it.store:
            notes_parts.append(f"Magasin: {it.store.name}")
        if it.estimated_cost is not None:
            notes_parts.append(f"Coût estimé: {it.estimated_cost:.2f} $")
        if it.product_url:
            notes_parts.append(it.product_url)
        notes = "\n".join(notes_parts) if notes_parts else None

        try:
            await create_task(access_token, list_id, task_title, notes)
            created += 1
        except Exception as e:
            errors.append(f"{name}: {str(e)[:60]}")

    return {
        "google_tasklist_id": list_id,
        "title": title,
        "tasks_created": created,
        "total_items": len(items),
        "errors": errors,
        "google_email": user.google_email,
    }


@router.post("/{batch_id}/fill-maxi-cart", status_code=202)
async def fill_maxi_cart(
    batch_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Dispatch the Playwright-driven Maxi cart filler for this batch.

    Requires the caller to have Maxi creds stored (set via
    ``PUT /api/auth/maxi-creds``). The worker opens a headful Chromium on
    the server's desktop — the user physically watches it log in + add
    items + validate in the end.

    Right now the endpoint trusts any call to know which user owns the
    creds — we read the batch's ``user_id`` if present, else fall back
    to the first user with Maxi creds. Replace with ``Depends(get_current_user)``
    when the frontend always sends a token.
    """
    from app.models.user import User
    from app.models.job import ImportJob
    from app.workers.maxi_cart import fill_maxi_cart as celery_fill

    batch = await db.get(Batch, batch_id)
    if not batch:
        raise HTTPException(404, "Batch not found")

    # Resolve user — prefer batch.user_id, otherwise first user with creds
    user = None
    if batch.user_id is not None:
        user = await db.get(User, batch.user_id)
    if not user or not user.maxi_password_encrypted:
        q = select(User).where(User.maxi_password_encrypted.isnot(None)).limit(1)
        user = (await db.execute(q)).scalar_one_or_none()
    if not user or not user.maxi_password_encrypted:
        raise HTTPException(
            409,
            "Aucun utilisateur n'a enregistré ses creds Maxi. Va dans /settings.",
        )

    job = ImportJob(
        job_type="maxi_cart_fill",
        status="queued",
        progress_current=0,
        progress_total=0,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    try:
        task = celery_fill.delay(job.id, batch_id, user.id)
        job.celery_task_id = task.id
        job.status = "running"
        await db.commit()
    except Exception as e:
        job.status = "failed"
        job.error_log = __import__("json").dumps([str(e)])
        await db.commit()
        raise HTTPException(500, f"Dispatch impossible: {e}")

    return {"job_id": job.id, "status": job.status, "task_id": job.celery_task_id}


@router.post("/{batch_id}/duplicate", response_model=BatchOut, status_code=201)
async def duplicate_batch(batch_id: int, db: AsyncSession = Depends(get_db)):
    """Clone a batch — same recipes, same portions, fresh shopping list.

    This lets the user "re-do last week's menu" in one click. The new batch
    starts in ``draft`` status with ``(copie)`` appended to its name.
    """
    from app.services.batch_generator import persist_batch_from_slots

    original = await db.get(Batch, batch_id)
    if not original:
        raise HTTPException(404, "Batch not found")

    # Gather (recipe_id, portions) from original via its BatchRecipe rows.
    # We include BOTH active and inactive rows — a user duplicating a batch
    # expects the full menu, and audit #7 pointed out we were silently
    # dropping inactive recipes (eg. recipes paused mid-batch).
    q = select(BatchRecipe).where(BatchRecipe.batch_id == batch_id)
    brs = list((await db.execute(q)).scalars().all())
    if not brs:
        raise HTTPException(400, "Batch has no recipes to duplicate.")

    slots = [(br.recipe_id, br.portions) for br in brs]
    target_portions = sum(p for _, p in slots)
    new_name = f"{original.name or f'Batch #{original.id}'} (copie)"

    return await persist_batch_from_slots(
        db,
        target_portions=target_portions,
        slots=slots,
        name=new_name,
    )


@router.patch("/{batch_id}/status")
async def update_status(batch_id: int, status: str, db: AsyncSession = Depends(get_db)):
    batch = await db.get(Batch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    batch.status = status
    await db.commit()
    return {"id": batch_id, "status": status}


@router.patch("/{batch_id}/shopping-items/{item_id}/purchase")
async def mark_item_purchased(
    batch_id: int,
    item_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Mark a shopping item as purchased and push the leftover bulk into inventory."""
    item = await db.get(ShoppingListItem, item_id)
    if not item or item.batch_id != batch_id:
        raise HTTPException(status_code=404, detail="Shopping item not found")
    if item.is_purchased:
        return {"status": "already_purchased", "id": item_id}

    item.is_purchased = True
    item.purchased_at = utcnow()
    await db.commit()

    surplus = await settle_shopping_item(db, item_id)
    return {
        "status": "ok",
        "id": item_id,
        "surplus_added": surplus.quantity if surplus else 0,
        "surplus_unit": surplus.unit if surplus else None,
    }


@router.patch("/{batch_id}/shopping-items/{item_id}/unpurchase")
async def unmark_item_purchased(
    batch_id: int,
    item_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Undo a purchase mark (does not roll back inventory; use inventory CRUD for that)."""
    item = await db.get(ShoppingListItem, item_id)
    if not item or item.batch_id != batch_id:
        raise HTTPException(status_code=404, detail="Shopping item not found")
    item.is_purchased = False
    item.purchased_at = None
    await db.commit()
    return {"status": "ok", "id": item_id}


@router.post("/{batch_id}/shopping-items/bulk-purchase")
async def bulk_purchase(
    batch_id: int,
    body: BulkPurchaseRequest,
    db: AsyncSession = Depends(get_db),
):
    """Mark multiple shopping items as purchased and push leftover bulk into inventory."""
    if not body.item_ids:
        return {"status": "ok", "items": []}

    q = select(ShoppingListItem).where(
        ShoppingListItem.id.in_(body.item_ids),
        ShoppingListItem.batch_id == batch_id,
    )
    items = list((await db.execute(q)).scalars().all())

    # Atomicity (audit fix): mark-purchased + settle-inventory must succeed
    # together or rollback together per item. Previously we batch-committed
    # is_purchased=True for ALL items, then settled sequentially — a crash
    # in the middle left items flagged purchased with no inventory entry.
    # Now: per-item try/except; if settle fails, revert is_purchased.
    now = utcnow()
    results = []
    failures: list[dict] = []
    for item in items:
        if item.is_purchased:
            continue
        item.is_purchased = True
        item.purchased_at = now
        try:
            await db.commit()
        except Exception as e:
            await db.rollback()
            failures.append({"id": item.id, "error": f"mark-purchased failed: {e}"})
            continue

        try:
            surplus = await settle_shopping_item(db, item.id)
            results.append({
                "id": item.id,
                "surplus_added": surplus.quantity if surplus else 0,
                "surplus_unit": surplus.unit if surplus else None,
            })
        except Exception as e:
            # Settlement failed — roll back the purchase flag so the item
            # isn't stuck in an inconsistent state.
            item.is_purchased = False
            item.purchased_at = None
            try:
                await db.commit()
            except Exception:
                await db.rollback()
            failures.append({"id": item.id, "error": f"settle failed: {e}"})

    return {"status": "ok", "items": results, "failures": failures}
