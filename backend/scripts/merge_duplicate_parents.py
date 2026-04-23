"""Merge near-duplicate canonical parents.

Clustering left parallel parents like 'abricot' / 'abricots',
'abricot_sec' / 'abricot_séché', 'huile_dolive' / 'huile_olive'
(singular/plural, accent variations, apostrophe mishaps). This script
collapses those into a single parent using the deterministic signature
from scripts/deterministic_cluster.py as the grouping key.

Merge rules per cluster of ≥2 parents:
  Winner = most variants first, then most recipe uses, then shortest
           canonical_name, then lowest id. Deterministic tie-break.

  For each loser:
    - Move all variants (parent_id = loser.id) to winner.id
    - Move all StoreProduct (ingredient_master_id = loser.id) to winner
      (but if winner already has SP for same store, keep winner's)
    - Move RecipeIngredient references → winner
    - Move InventoryItem / InventoryMovement / ShoppingListItem /
      ReceiptItem references → winner
    - Demote loser to variant: parent_id = winner.id, canonical_name =
      '<orig>__merged_<id>' (unique), status = 'variant'

Dry by default. Pass --apply to write.
"""
from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import sqlite3

DB = Path(__file__).resolve().parent.parent / "batchchef.db"


# Signature logic shared with runtime ingredient resolution so the import
# pipeline prevents duplicates at their source instead of cleaning up after.
from app.services.ingredient_resolution import signature  # noqa: F401


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

FK_TABLES = [
    ("recipe_ingredient", "ingredient_master_id"),
    ("inventory_item", "ingredient_master_id"),
    ("inventory_movement", "ingredient_master_id"),
    ("shopping_list_item", "ingredient_master_id"),
    ("receipt_item", "ingredient_master_id"),
]


def pick_winner(rows: list[dict]) -> dict:
    """Given a cluster of parent rows (dicts with id, canonical_name,
    variants_count, uses_count), return the canonical winner."""
    # Prefer: most variants → most uses → shortest name → lowest id
    rows_sorted = sorted(
        rows,
        key=lambda r: (
            -int(r.get("variants_count", 0) or 0),
            -int(r.get("uses_count", 0) or 0),
            len(r["canonical_name"] or ""),
            r["id"],
        ),
    )
    return rows_sorted[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Write DB (default dry)")
    args = parser.parse_args()

    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA foreign_keys = ON")
    c = conn.cursor()

    # Load all parents w/ usage + variant counts
    c.execute(
        """
        SELECT im.id, im.canonical_name, im.display_name_fr,
               im.price_mapping_status,
               (SELECT COUNT(*) FROM ingredient_master v WHERE v.parent_id = im.id) AS variants_count,
               (SELECT COUNT(*) FROM recipe_ingredient ri WHERE ri.ingredient_master_id = im.id) AS direct_uses
        FROM ingredient_master im
        WHERE im.parent_id IS NULL
        """
    )
    parents = [
        {
            "id": r[0],
            "canonical_name": r[1],
            "display_name_fr": r[2],
            "status": r[3],
            "variants_count": r[4] or 0,
            "uses_count": r[5] or 0,
        }
        for r in c.fetchall()
    ]
    print(f"Loaded {len(parents)} parents.")

    # Group by signature
    by_sig: dict[str, list[dict]] = defaultdict(list)
    for p in parents:
        sig = signature(p["canonical_name"])
        if not sig:
            continue
        by_sig[sig].append(p)

    dupes = {sig: rows for sig, rows in by_sig.items() if len(rows) > 1}
    print(f"Found {len(dupes)} signature groups with ≥2 parents:")
    for sig, rows in sorted(dupes.items(), key=lambda kv: -len(kv[1]))[:20]:
        names = [r["canonical_name"] for r in rows]
        print(f"  {sig:<30}  → {', '.join(names[:5])}{'…' if len(names) > 5 else ''}")

    if not args.apply:
        print("\n--dry: no DB writes")
        return 0

    # Apply merges
    total_losers = 0
    for sig, rows in dupes.items():
        winner = pick_winner(rows)
        losers = [r for r in rows if r["id"] != winner["id"]]
        wid = winner["id"]

        for loser in losers:
            lid = loser["id"]
            # 1. Move loser's variants to winner
            c.execute(
                "UPDATE ingredient_master SET parent_id = ? WHERE parent_id = ?",
                (wid, lid),
            )
            # 2. Move FK tables that reference the loser's id
            for table, col in FK_TABLES:
                c.execute(
                    f"UPDATE {table} SET {col} = ? WHERE {col} = ?",
                    (wid, lid),
                )
            # 3. StoreProduct — if winner has no SP for a given store, move
            #    loser's there. Otherwise keep winner's and drop loser's
            #    duplicate so the unique(ingredient_id, store_id) holds.
            c.execute(
                """
                SELECT store_id FROM store_product WHERE ingredient_master_id = ?
                """,
                (wid,),
            )
            winner_store_ids = {row[0] for row in c.fetchall()}
            c.execute(
                """
                SELECT id, store_id FROM store_product WHERE ingredient_master_id = ?
                """,
                (lid,),
            )
            for sp_id, store_id in c.fetchall():
                if store_id in winner_store_ids:
                    # Winner already has a StoreProduct for this store; drop loser's
                    c.execute("DELETE FROM store_product WHERE id = ?", (sp_id,))
                else:
                    c.execute(
                        "UPDATE store_product SET ingredient_master_id = ? WHERE id = ?",
                        (wid, sp_id),
                    )
            # 4. Demote loser to variant of winner (unique canonical name so
            #    we don't hit the UNIQUE constraint)
            c.execute(
                """
                UPDATE ingredient_master
                SET parent_id = ?,
                    canonical_name = ? ,
                    price_mapping_status = 'variant'
                WHERE id = ?
                """,
                (wid, f"{loser['canonical_name']}__merged_{lid}", lid),
            )
            total_losers += 1

    conn.commit()
    print(f"\nMerged {total_losers} duplicate parents across {len(dupes)} groups.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
