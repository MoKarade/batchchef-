"""Heuristic repair for StoreProducts stuck at format_qty=1, format_unit='unite'.

Why this exists:
  Maxi tiles sometimes list a product at "4.17$ / douzaine" AND at "0.35$ / unité"
  on the same card, and our scraper sometimes grabs the per-unit price while
  mis-tagging format_qty=1. Classic example: eggs end up as "1 egg = 4.17$",
  then the batch generator computes "31 eggs = 129.27$".

  The product_name almost always encodes the real pack size — "Gros œufs
  de catégorie A, 12 unités", "Pack de 6", "Boîte de 250 g", etc. This
  script reparses the name, extracts the true (qty, unit), and patches
  any row where we're confident the current (1, unite) is wrong.

Re-run safe. Dry by default; --apply writes the DB.
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "batchchef.db"


# ---------------------------------------------------------------------------
# Heuristics — ordered by specificity. First match wins.
# ---------------------------------------------------------------------------

# Each pattern returns (qty: float, unit: str).
# Keep units normalised to one of: g, kg, ml, l, unite.

def _parse_pack(name: str, canonical_hint: str = "") -> tuple[float, str] | None:
    """Parse a pack format out of a product name, or None if nothing
    unambiguous found. canonical_hint gives us the ingredient's canonical
    name (e.g. 'oeuf') to bias ambiguous matches."""
    n = name.lower()
    hint = (canonical_hint or "").lower()

    # Multi-pack: "6×250g", "24 x 33 g", "pack de 6 — 500 ml"
    m = re.search(r"(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|cl)\b", n)
    if m:
        count = int(m.group(1))
        per = float(m.group(2).replace(",", "."))
        unit = m.group(3)
        # Convert cl to ml, keep others as-is
        if unit == "cl":
            per, unit = per * 10, "ml"
        return count * per, unit

    # Explicit dozen: "douzaine", "12 œufs", "dozen"
    if re.search(r"douzaine|dozen|\b12\s*(?:œuf|oeuf|eggs?|unit)", n):
        return 12.0, "unite"

    # "œufs" products with no explicit count — always come as dozen at Maxi
    if (
        ("œuf" in n or "oeuf" in n or "oeufs" in n)
        and ("œuf" in hint or "oeuf" in hint or hint == "")
        and not re.search(r"\b1\s*œuf|\b1\s*oeuf", n)
    ):
        # Count-based egg package, default 12
        m = re.search(r"\b(\d{1,2})\s*(?:œufs?|oeufs?|unit)", n)
        if m:
            n_eggs = int(m.group(1))
            if 4 <= n_eggs <= 30:
                return float(n_eggs), "unite"
        return 12.0, "unite"

    # "pack de N", "paquet de N", "boîte de N (unités)"
    m = re.search(
        r"(?:pack|paquet|bo[iî]te|ensemble|emballage)\s*(?:de|d')?\s*(\d+)\s*(?:unit(?:e|é)s?|pi[eè]ces?|œufs?|oeufs?|muffins?|pains?|tranches?|saucisses?|croissants?)?",
        n,
    )
    if m:
        return float(m.group(1)), "unite"

    # Just "N unité(s)" / "N pièces"
    m = re.search(r"\b(\d+)\s*(?:unit(?:e|é)s?|pi[eè]ces?|pcs?|ct|count)\b", n)
    if m:
        count = int(m.group(1))
        if 2 <= count <= 100:
            return float(count), "unite"

    # Mass in package: "500 g", "1.5 kg", "250g"  (typical Maxi suffix)
    m = re.search(r"\b(\d+(?:[.,]\d+)?)\s*(kg|g)\b", n)
    if m:
        qty = float(m.group(1).replace(",", "."))
        unit = m.group(2)
        # Sanity: reject absurd masses for single-item products
        if (unit == "g" and 20 <= qty <= 5000) or (unit == "kg" and 0.1 <= qty <= 20):
            return qty, unit

    # Volume: "500 ml", "1 l", "1.5L"
    m = re.search(r"\b(\d+(?:[.,]\d+)?)\s*(ml|l)\b", n)
    if m:
        qty = float(m.group(1).replace(",", "."))
        unit = m.group(2)
        if (unit == "ml" and 50 <= qty <= 5000) or (unit == "l" and 0.1 <= qty <= 20):
            return qty, unit

    return None


# ---------------------------------------------------------------------------
# Main — scan, propose, optionally apply
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Write DB (default dry)")
    parser.add_argument("--limit", type=int, default=None, help="Only process N rows")
    args = parser.parse_args()

    conn = sqlite3.connect(DB)
    c = conn.cursor()

    # Find all StoreProducts where format looks trivially wrong.
    # Criteria: format_qty IN (1.0, NULL) AND format_unit IN ('unite', NULL)
    # AND there's a product_name we can parse.
    q = """
      SELECT sp.id, sp.product_name, sp.price, sp.format_qty, sp.format_unit,
             im.canonical_name, im.display_name_fr
      FROM store_product sp
      JOIN ingredient_master im ON im.id = sp.ingredient_master_id
      WHERE sp.price IS NOT NULL
        AND sp.product_name IS NOT NULL
        AND (sp.format_qty IS NULL OR sp.format_qty = 1.0)
        AND (sp.format_unit IS NULL OR sp.format_unit = 'unite')
    """
    if args.limit:
        q += f" LIMIT {args.limit}"
    c.execute(q)
    rows = c.fetchall()
    print(f"Scanning {len(rows)} suspicious rows...")

    fixes: list[tuple[int, float, str, float, str, str]] = []
    unchanged = 0
    for sp_id, name, price, cur_qty, cur_unit, canonical, display in rows:
        parsed = _parse_pack(name or "", canonical or "")
        if parsed is None:
            unchanged += 1
            continue
        new_qty, new_unit = parsed
        # Only fix if actually different
        if cur_qty == new_qty and (cur_unit or "unite") == new_unit:
            unchanged += 1
            continue
        fixes.append((sp_id, cur_qty or 1.0, cur_unit or "unite", new_qty, new_unit, name))

    print(f"  → {len(fixes)} rows proposed for fix, {unchanged} left alone\n")
    for sp_id, old_q, old_u, new_q, new_u, name in fixes[:40]:
        print(f"  [{sp_id:>5}] {old_q}{old_u} → {new_q}{new_u}  «{name[:60]}»")
    if len(fixes) > 40:
        print(f"  … and {len(fixes) - 40} more\n")

    if not args.apply:
        print("\n--apply not set; no DB writes.")
        return 0

    if not fixes:
        print("\nNothing to apply.")
        return 0

    for sp_id, _, _, new_q, new_u, _ in fixes:
        c.execute(
            "UPDATE store_product SET format_qty = ?, format_unit = ? WHERE id = ?",
            (new_q, new_u, sp_id),
        )
    conn.commit()
    print(f"\nApplied {len(fixes)} updates.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
