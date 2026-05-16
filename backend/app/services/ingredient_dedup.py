"""Detect and merge duplicate IngredientMaster rows using Gemini similarity check."""
import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_MAX_CANDIDATES = 200  # max existing ingredients to compare against


async def find_and_merge_duplicates(db: AsyncSession, new_ids: list[int]) -> int:
    """Detect near-duplicate IngredientMaster rows among new_ids + similar existing ones.
    Merges duplicates: migrates RecipeIngredient + StoreProduct + InventoryItem, deletes redundant row.
    Returns count of merged pairs.
    """
    from app.models.ingredient import IngredientMaster
    from app.models.recipe import RecipeIngredient
    from app.models.store import StoreProduct
    from app.models.inventory import InventoryItem
    from difflib import SequenceMatcher

    def _similarity(a: str, b: str) -> float:
        return SequenceMatcher(None, a, b).ratio()

    if not new_ids:
        return 0

    new_ings = list((await db.execute(
        select(IngredientMaster).where(IngredientMaster.id.in_(new_ids))
    )).scalars().all())

    if not new_ings:
        return 0

    # Fetch existing ingredients
    all_q = select(IngredientMaster).where(IngredientMaster.id.not_in(new_ids)).limit(_MAX_CANDIDATES)
    existing = list((await db.execute(all_q)).scalars().all())

    # Build candidate pairs: similarity >= 0.82 and names differ
    candidate_pairs: list[tuple[IngredientMaster, IngredientMaster]] = []
    for new_ing in new_ings:
        for ex_ing in existing:
            sim = _similarity(new_ing.canonical_name, ex_ing.canonical_name)
            if sim >= 0.82 and new_ing.canonical_name != ex_ing.canonical_name:
                candidate_pairs.append((new_ing, ex_ing))

    if not candidate_pairs:
        return 0

    # AI confirm duplicates
    confirmed_pairs = await _confirm_duplicates_with_ai(candidate_pairs)
    if not confirmed_pairs:
        return 0

    merged = 0
    for keep_ing, remove_ing in confirmed_pairs:
        try:
            # Migrate all references from remove_ing → keep_ing
            await db.execute(
                RecipeIngredient.__table__.update()
                .where(RecipeIngredient.ingredient_master_id == remove_ing.id)
                .values(ingredient_master_id=keep_ing.id)
            )
            await db.execute(
                StoreProduct.__table__.update()
                .where(StoreProduct.ingredient_master_id == remove_ing.id)
                .values(ingredient_master_id=keep_ing.id)
            )
            await db.execute(
                InventoryItem.__table__.update()
                .where(InventoryItem.ingredient_master_id == remove_ing.id)
                .values(ingredient_master_id=keep_ing.id)
            )
            # Migrate children (variants)
            await db.execute(
                IngredientMaster.__table__.update()
                .where(IngredientMaster.parent_id == remove_ing.id)
                .values(parent_id=keep_ing.id)
            )
            await db.delete(remove_ing)
            merged += 1
            logger.info(f"Dedup: merged '{remove_ing.canonical_name}' → '{keep_ing.canonical_name}'")
        except Exception as e:
            logger.warning(f"Dedup merge failed for {remove_ing.canonical_name}: {e}")

    if merged:
        await db.commit()

    return merged


async def _confirm_duplicates_with_ai(pairs: list) -> list:
    """Ask Claude which pairs are true duplicates. Returns (keep, remove) tuples."""
    from app.ai.client import call_claude
    from app.ai.utils import parse_json_response
    import json

    if not pairs:
        return []

    payload = [
        {"a": p[0].canonical_name, "b": p[1].canonical_name}
        for p in pairs[:40]
    ]
    system = (
        "Tu es un expert culinaire. Pour chaque paire (a, b), dis si ce sont deux noms pour "
        "le MÊME ingrédient culinaire (vrai doublon). "
        "Réponds UNIQUEMENT avec un JSON array de bool (true=doublon, false=différent), "
        "même ordre que l'input."
    )
    user = f"Input: {json.dumps(payload, ensure_ascii=False)}"

    try:
        text = await call_claude(system, user)
        results = parse_json_response(text)
        if not isinstance(results, list) or len(results) != len(payload):
            return []
        confirmed = []
        for (new_ing, ex_ing), is_dup in zip(pairs[:40], results):
            if is_dup:
                keep, remove = (ex_ing, new_ing) if len(ex_ing.canonical_name) <= len(new_ing.canonical_name) else (new_ing, ex_ing)
                confirmed.append((keep, remove))
        return confirmed
    except Exception as e:
        logger.warning(f"Dedup AI confirmation failed: {e}")
        return []
