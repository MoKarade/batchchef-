"""Deterministic canonical/variant clustering (no API calls).

Groups all IngredientMaster rows into clusters using a strictly
deterministic normalization:

  1. Apply clean_canonical() (already strips measurement/packaging prefixes
     and known truncations).
  2. Strip parenthesised content:     "beurre_(mou)"   → "beurre"
  3. Strip accents:                   "crème"          → "creme"
  4. Strip digits + units:            "thon_200g"      → "thon"
  5. Singular-ize tail 's':           "tomates"        → "tomate"
  6. Drop leftover packaging/qty noise words.

Two rows with the same "signature" cluster together. Each cluster gets
one parent (the row whose canonical_name already matches the signature,
else the most-used row). Everyone else becomes a variant.

Rows whose signature is None (invalids) get status='invalid', parent_id=NULL.

Handles UNIQUE collisions by merging two clusters whose signature matches
an existing canonical_name outside the cluster.

Re-run safe. Pass --dry to preview without writing.
"""
from __future__ import annotations

import argparse
import logging
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select, update, func
from app.database import AsyncSessionLocal, init_db
from app.models.ingredient import IngredientMaster
from app.models.recipe import RecipeIngredient
from app.ai.name_cleaner import clean_canonical

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("deterministic_cluster")


# Modifiers that are NOT distinguishing at the Maxi-product level.
# Adding them here will collapse "beurre_mou" → "beurre" etc.
_EXTRA_STOP_WORDS = {
    # Texture modifiers — same Maxi product, different preparation state
    "mou", "mous", "molle", "molles",
    "dur", "dure",
    # Intentionally NOT in this list because they're distinguishing:
    #   doux/sale/demi_sel → distinct butter SKUs
    #   petit/grand/moyen  → "petit_beurre" is a cookie, "petits_pois" is
    #                        a specific product, not "small butter/peas"
    # Generic quality adjectives — truly non-distinguishing
    "entier", "entiers", "entiere", "entieres",
    "nature", "naturel", "naturels", "naturelle", "naturelles",
    "classique", "classiques",
    "ordinaire", "ordinaires",
    "normal", "normale",
    "supplement", "supplementaire",
    "facultatif", "facultative", "optionnel", "optionnelle",
    "environ", "env", "approx",
    "bien", "tres", "plus",
    "quelques", "quelque",
}


# Words that are containers but got through clean_canonical somehow
_EXTRA_PACKAGING = {
    "cube", "cubes", "barre", "barres", "carre", "carres",
    "rondelle", "rondelles", "lamelle", "lamelles",
    "quartier", "quartiers",
    "demi", "moitie",
}

_PACKAGING_PREFIX_RE = re.compile(
    r"^(?:" + "|".join(_EXTRA_PACKAGING) + r")_+",
    re.IGNORECASE,
)

_UNIT_RE = re.compile(
    r"(?:^|_)\d+[.,]?\d*\s*(?:kg|g|ml|cl|l|mg|pc|pcs|oz|lb|lbs|pounds?|pound)(?=_|$)",
    re.IGNORECASE,
)


def _strip_accents(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def signature(raw_name: str) -> str | None:
    """Return a canonical key grouping equivalent names together, or None if
    the input is not a real ingredient."""
    if not raw_name:
        return None
    # Step 1: use the deterministic cleaner (strips measurement prefixes,
    # fixes truncations like 'ousses_dail'→'ail', 'eurre'→'beurre')
    c = clean_canonical(raw_name)
    if c is None:
        return None

    # Step 2: strip parenthesized content
    c = re.sub(r"\([^)]*\)", " ", c)
    c = re.sub(r"[\[{][^\]}]*[\]}]", " ", c)

    # Step 3: strip accents + lowercase
    c = _strip_accents(c).lower()

    # Step 4: strip digits + unit suffixes — "thon_200g" → "thon"
    c = _UNIT_RE.sub("", c)
    c = re.sub(r"\d+", "", c)

    # Step 5: strip trailing packaging words like "cubes", "rondelles"
    while True:
        m = _PACKAGING_PREFIX_RE.match(c)
        if not m:
            break
        c = c[m.end():]

    # Clean up leftover underscores / spaces
    c = re.sub(r"[_\s\-.,+%]+", "_", c).strip("_")
    if not c:
        return None

    # Step 6: drop _EXTRA_STOP_WORDS tokens
    tokens = [t for t in c.split("_") if t and t not in _EXTRA_STOP_WORDS]
    if not tokens:
        return None
    c = "_".join(tokens)

    # Step 7: tail-s singularization for long-enough tokens
    parts = c.split("_")
    new_parts: list[str] = []
    for p in parts:
        if len(p) > 4 and p.endswith("s") and not p.endswith("ss"):
            new_parts.append(p[:-1])
        else:
            new_parts.append(p)
    c = "_".join(new_parts)

    # Final checks
    if len(c) < 3:
        return None
    if c in {"et", "ou", "de", "du", "au", "aux", "le", "la", "les", "un", "une", "des"}:
        return None
    return c


def pick_canonical_row(rows: list[tuple], sig: str) -> tuple:
    """Pick the best representative for a cluster.

    Preference order:
      1. Row whose own `clean_canonical()` result equals the signature
      2. Row whose `canonical_name` equals the signature
      3. Most-used row (highest recipe count)
      4. Shortest canonical_name
    """
    def score(r):
        _, cn, _, _, uses = r
        cleaned = clean_canonical(cn or "") or ""
        cleaned_sig = signature(cn or "") or ""
        return (
            0 if cleaned == sig else 1,
            0 if (cn or "") == sig else 1,
            -int(uses or 0),
            len(cn or ""),
        )
    return sorted(rows, key=score)[0]


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry", action="store_true", help="preview without DB writes")
    parser.add_argument("--limit", type=int, default=None, help="only process the top N used ingredients")
    args = parser.parse_args()

    await init_db()

    async with AsyncSessionLocal() as db:
        q = (
            select(
                IngredientMaster.id,
                IngredientMaster.canonical_name,
                IngredientMaster.display_name_fr,
                IngredientMaster.category,
                func.count(RecipeIngredient.id).label("uses"),
            )
            .outerjoin(RecipeIngredient, RecipeIngredient.ingredient_master_id == IngredientMaster.id)
            .group_by(IngredientMaster.id)
            .order_by(func.count(RecipeIngredient.id).desc())
        )
        if args.limit:
            q = q.limit(args.limit)
        rows = list((await db.execute(q)).all())
    log.info(f"loaded {len(rows)} ingredients")

    # Compute signatures + bucket
    by_sig: dict[str, list[tuple]] = defaultdict(list)
    invalid_ids: list[int] = []
    for row in rows:
        sig = signature(row[1])
        if sig is None:
            invalid_ids.append(row[0])
        else:
            by_sig[sig].append(row)

    log.info(f"distinct signatures: {len(by_sig)}")
    log.info(f"invalids: {len(invalid_ids)}")
    log.info(f"clusters with ≥2 members: {sum(1 for v in by_sig.values() if len(v) >= 2)}")
    log.info(f"singletons: {sum(1 for v in by_sig.values() if len(v) == 1)}")

    # Show biggest clusters
    biggest = sorted(by_sig.items(), key=lambda kv: -len(kv[1]))[:20]
    log.info("Biggest clusters:")
    for sig, members in biggest:
        sample_names = [m[1] for m in members[:3]]
        log.info(f"  [{len(members):>4}]  {sig:<30}  ← {', '.join(sample_names)}")

    if args.dry:
        log.info("--dry: no DB writes")
        return 0

    # Apply to DB
    async with AsyncSessionLocal() as db:
        # Step 1: invalids
        if invalid_ids:
            await db.execute(
                update(IngredientMaster)
                .where(IngredientMaster.id.in_(invalid_ids))
                .values(price_mapping_status="invalid", parent_id=None)
            )
            log.info(f"  marked {len(invalid_ids)} invalid")

        # Step 2: for each cluster, promote canonical + reparent
        # We need to handle UNIQUE collisions on canonical_name. Strategy:
        # after we renumber everything, ALL parents have distinct names
        # because by_sig has distinct signatures. But during the process, we
        # might temporarily have a naming collision with a row OUTSIDE this
        # cluster. We work around this by using a two-pass approach:
        #   Pass 1: rename all cluster canonicals to a temporary unique name
        #           (prefix "__sig__:<sig>") so no collision is possible.
        #   Pass 2: rename each canonical to its final signature.
        # The variants are re-parented in Pass 1; in Pass 2 we set their
        # parent_id accordingly.
        sigs_sorted = sorted(by_sig.items(), key=lambda kv: -len(kv[1]))

        # Pass 1: for each cluster, pick its canonical + set temp name
        cluster_canonical: dict[str, int] = {}  # sig → canonical ingredient_id
        for sig, members in sigs_sorted:
            canonical_row = pick_canonical_row(members, sig)
            canonical_id = canonical_row[0]
            cluster_canonical[sig] = canonical_id
            # Temp-rename to avoid UNIQUE collisions
            temp_name = f"__pending__{canonical_id}"
            await db.execute(
                update(IngredientMaster)
                .where(IngredientMaster.id == canonical_id)
                .values(canonical_name=temp_name, parent_id=None)
            )
            # Re-parent the rest of the cluster using temp name too
            child_ids = [m[0] for m in members if m[0] != canonical_id]
            if child_ids:
                await db.execute(
                    update(IngredientMaster)
                    .where(IngredientMaster.id.in_(child_ids))
                    .values(parent_id=canonical_id, price_mapping_status="variant")
                )
        await db.commit()
        log.info(f"Pass 1 complete: {len(cluster_canonical)} canonicals set to temp names, variants re-parented")

        # Pass 2: rename each canonical to its final signature + set status
        # Preserve 'mapped' status if already set.
        for sig, canonical_id in cluster_canonical.items():
            row = (await db.execute(
                select(IngredientMaster).where(IngredientMaster.id == canonical_id)
            )).scalar_one_or_none()
            if not row:
                continue
            new_display = sig.replace("_", " ").strip()
            new_status = row.price_mapping_status if row.price_mapping_status == "mapped" else "pending"
            await db.execute(
                update(IngredientMaster)
                .where(IngredientMaster.id == canonical_id)
                .values(
                    canonical_name=sig,
                    display_name_fr=new_display if not row.display_name_fr or row.display_name_fr == row.canonical_name else row.display_name_fr,
                    price_mapping_status=new_status,
                )
            )
        await db.commit()
        log.info("Pass 2 complete: canonicals renamed to final signatures")

    log.info("DONE")
    return 0


if __name__ == "__main__":
    import asyncio
    sys.exit(asyncio.run(main()))
