"""Ingredient-name resolution — shared logic to map a raw canonical_name
to an existing IngredientMaster row (either a direct match, or a sibling
under an existing parent with the same normalized signature).

Used by:
  - import_marmiton._persist_recipe    : attach new ingredients under an
                                          existing parent whenever possible
                                          instead of spawning a duplicate.
  - scripts/merge_duplicate_parents.py  : one-shot cleanup of the current DB
                                          (re-uses the same signature()).

The signature is deliberately conservative: singular/plural + accent folds
+ œ/oe + a short list of strict grocery synonyms (sec↔séché,
surgelé↔congelé). It does NOT strip 'jus_de_', 'zeste_de_', quality
adjectives, or packaging prefixes — those genuinely distinguish different
Maxi SKUs ('fromage_frais' ≠ 'fromage_fondu', 'jus_de_citron' ≠ 'citron').
"""
from __future__ import annotations

import re
import unicodedata

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ingredient import IngredientMaster


_STRICT_SYNONYMS = {
    "seche": "sec",
    "sechees": "sec",
    "sechee": "sec",
    "secs": "sec",
    "seches": "sec",
    "congele": "surgele",
    "congelee": "surgele",
    "congelees": "surgele",
    "congeles": "surgele",
    "surgelee": "surgele",
    "surgelees": "surgele",
    "surgeles": "surgele",
}


def _strip_accents(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.replace("œ", "oe").replace("Œ", "OE")


def signature(name: str) -> str | None:
    """Return a normalized key grouping grocery-equivalent names.

    Two names share a signature iff they refer to the same Maxi SKU.
    Conservative on purpose — we'd rather leave two things un-merged
    than collapse distinct products.
    """
    if not name:
        return None
    c = name.lower().strip()
    c = c.replace("'", "").replace("'", "").replace("'", "")
    c = _strip_accents(c)
    c = re.sub(r"[\s\-.,/]+", "_", c)
    c = re.sub(r"_+", "_", c).strip("_")
    if len(c) < 3:
        return None
    tokens = [t for t in c.split("_") if t]
    singular = [
        (t[:-1] if len(t) > 4 and t.endswith("s") and not t.endswith("ss") else t)
        for t in tokens
    ]
    final = [_STRICT_SYNONYMS.get(t, t) for t in singular]
    return "_".join(final)


async def find_parent_for_name(
    db: AsyncSession, canonical_name: str
) -> IngredientMaster | None:
    """Return the existing canonical parent (if any) whose signature matches
    the given canonical_name. Prefer parents over variants so a new row that
    would collide with an existing parent attaches to it rather than
    re-creating a fork.

    Looks up by the exact name first (fast path), then computes the signature
    and scans parents sharing that signature.
    """
    sig = signature(canonical_name)
    if sig is None:
        return None

    # Fast exact-match path
    exact_q = select(IngredientMaster).where(
        IngredientMaster.canonical_name == canonical_name
    )
    exact = (await db.execute(exact_q)).scalar_one_or_none()
    if exact is not None:
        # If it's already a variant, walk up to its parent
        if exact.parent_id is not None:
            parent = await db.get(IngredientMaster, exact.parent_id)
            if parent is not None:
                return parent
        return exact

    # Slower signature scan across all parents. For very large DBs this is
    # O(n) — for ours (~3500 parents) it's a few ms. We could cache the
    # signatures in-memory if it ever becomes a bottleneck.
    parents_q = select(IngredientMaster).where(
        IngredientMaster.parent_id.is_(None)
    )
    for row in (await db.execute(parents_q)).scalars():
        if signature(row.canonical_name) == sig:
            return row
    return None


async def resolve_or_create_ingredient(
    db: AsyncSession,
    canonical_name: str,
    display_name_fr: str | None = None,
) -> tuple[IngredientMaster, bool]:
    """Find or create the IngredientMaster row for a raw canonical name.

    Returns (row, created). If a parent with an equivalent signature exists,
    this creates a new variant under it (so 'abricots' becomes a variant of
    'abricot' instead of a parallel parent). If nothing matches, creates a
    new top-level row.
    """
    existing = await find_parent_for_name(db, canonical_name)

    # Check for an exact name match that's already a variant of the found
    # parent (avoid creating siblings with identical canonical_name)
    if existing is not None:
        exact_q = select(IngredientMaster).where(
            IngredientMaster.canonical_name == canonical_name
        )
        exact = (await db.execute(exact_q)).scalar_one_or_none()
        if exact is not None:
            return exact, False
        # Create as variant of existing parent
        new_row = IngredientMaster(
            canonical_name=canonical_name,
            display_name_fr=display_name_fr or canonical_name.replace("_", " ").title(),
            parent_id=existing.id,
            price_mapping_status="variant",
        )
        db.add(new_row)
        await db.flush()
        return new_row, True

    # Create brand-new top-level row
    new_row = IngredientMaster(
        canonical_name=canonical_name,
        display_name_fr=display_name_fr or canonical_name.replace("_", " ").title(),
    )
    db.add(new_row)
    await db.flush()
    return new_row, True
