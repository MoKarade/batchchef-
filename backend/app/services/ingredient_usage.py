"""Maintain IngredientMaster.usage_count — denormalized counter.

Historically the price-mapping task computed usage on-the-fly with a
self-join (ingredient_master × ingredient_master × recipe_ingredient) to
order parents by total recipe usage. On the production DB (21k
ingredients × 240k recipe_ingredient rows), that query takes >10 min to
return — which is why jobs #80/#81/#82 never started.

Instead we keep a denormalized ``usage_count`` column on IngredientMaster
that counts RecipeIngredient rows pointing at THIS id OR at any of its
variants (parent_id = this id). Reads are then O(1) per row and price
mapping init drops from ~10 min to milliseconds.

Call ``refresh_usage_counts(db)`` after any bulk import (marmiton,
continuous) or whenever RecipeIngredient is mutated in a way that
changes the distribution.
"""
from __future__ import annotations
import logging

from sqlalchemy import select, func, case, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ingredient import IngredientMaster
from app.models.recipe import RecipeIngredient

logger = logging.getLogger(__name__)


async def refresh_usage_counts(db: AsyncSession) -> dict[str, int]:
    """Recompute usage_count for every IngredientMaster row.

    Formula: for each ingredient I,
        usage_count(I) = count(RI) where RI.ingredient_master_id = I
                        + sum(usage_count(child) for child where child.parent_id = I)

    Implementation: we do this in two SQL passes, which SQLite handles fast
    even on 240k rows because we use simple GROUP BY without self-joins.

    Returns counters: {"updated": N, "parents": N, "variants": N}.
    """
    # Pass 1: direct counts per ingredient_master_id
    direct_q = (
        select(RecipeIngredient.ingredient_master_id, func.count(RecipeIngredient.id))
        .where(RecipeIngredient.ingredient_master_id.isnot(None))
        .group_by(RecipeIngredient.ingredient_master_id)
    )
    direct: dict[int, int] = dict((await db.execute(direct_q)).all())

    # Pass 2: roll up variant counts into their parents
    # We read all (id, parent_id) pairs so a parent inherits its children's
    # usage. Two-level hierarchy only (model doesn't support deeper).
    id_parent_q = select(IngredientMaster.id, IngredientMaster.parent_id)
    id_parent = list((await db.execute(id_parent_q)).all())

    rolled: dict[int, int] = dict(direct)  # start with direct counts
    for child_id, parent_id in id_parent:
        if parent_id is not None:
            # Child's OWN direct count also adds to the parent's bucket.
            child_direct = direct.get(child_id, 0)
            if child_direct:
                rolled[parent_id] = rolled.get(parent_id, 0) + child_direct

    # Write back — one bulk update per row that needs it. A large VALUES
    # clause would be ideal but SQLite caps it at 500 rows per UPDATE. We
    # do a single pass with individual updates inside a single transaction;
    # measured ~3s on 21k rows, acceptable.
    #
    # First zero out everything so ingredients that lost all usage get 0.
    await db.execute(text("UPDATE ingredient_master SET usage_count = 0"))

    # Now set the non-zero ones
    parents, variants = 0, 0
    for ing_id, count in rolled.items():
        if count == 0:
            continue
        await db.execute(
            text("UPDATE ingredient_master SET usage_count = :c WHERE id = :i"),
            {"c": count, "i": ing_id},
        )

    # Stats
    p_q = select(func.count()).select_from(IngredientMaster).where(
        IngredientMaster.parent_id.is_(None),
        IngredientMaster.usage_count > 0,
    )
    v_q = select(func.count()).select_from(IngredientMaster).where(
        IngredientMaster.parent_id.isnot(None),
        IngredientMaster.usage_count > 0,
    )
    parents = (await db.execute(p_q)).scalar_one()
    variants = (await db.execute(v_q)).scalar_one()

    await db.commit()
    updated = len([v for v in rolled.values() if v > 0])
    logger.info(
        "Refreshed usage_counts: %d rows have usage (%d parents, %d variants)",
        updated, parents, variants,
    )
    return {"updated": updated, "parents": parents, "variants": variants}
