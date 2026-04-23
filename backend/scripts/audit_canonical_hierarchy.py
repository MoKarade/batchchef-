"""Quality audit of the canonical/variant hierarchy.

Read-only. Flags anomalies introduced by the Gemini clustering step so we
don't waste hundreds of Maxi requests scraping junk parent names.

Checks:
  1. Shape stats (counts by status, parents vs variants, orphans)
  2. Parent name quality (regex on residual artifacts, display_name still
     mechanical, too-short names)
  3. Variant→parent integrity (variant pointing at invalid parent, cycles,
     chained variants, name drift)
  4. Sample 20 random variants with their parents for a human eye pass

Exits 0 if the result looks clean enough to proceed to mapping. Exits 1 if
enough anomalies are found that we should re-run the clustering.

Pass criteria (soft):
  * < 5 % parent anomalies
  * < 2 % variant anomalies
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select, func
from app.database import AsyncSessionLocal, init_db
from app.models.ingredient import IngredientMaster
from app.models.recipe import RecipeIngredient

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("audit")

# Residual-artifact regex: names that likely survived through clustering
# without being cleaned up. Any parent matching these needs investigation.
_BAD_PARENT_PATTERNS = [
    (r"^eurre", "missing leading letter ('eurre'→'beurre')"),
    (r"^ousses", "truncated 'gousses' artifact"),
    (r"^à?_?soupe", "measurement prefix leaked"),
    (r"^à?_?café", "measurement prefix leaked"),
    (r"^pincée?", "measurement prefix leaked"),
    (r"^poignée", "measurement prefix leaked"),
    (r"^sachets?_", "packaging prefix leaked"),
    (r"^boîtes?_", "packaging prefix leaked"),
    (r"^boites?_", "packaging prefix leaked"),
    (r"^tranches?_", "packaging prefix leaked"),
    (r"^morceaux?_", "packaging prefix leaked"),
    (r"^paquets?_", "packaging prefix leaked"),
    (r"_et_", "compound ingredient not split ('sel_et_poivre')"),
    (r"^\d", "starts with a digit"),
    (r"^[_\-]", "starts with punctuation"),
    (r"_{2,}", "double underscore"),
]
_BAD_PARENT_RE = [(re.compile(p, re.I), reason) for p, reason in _BAD_PARENT_PATTERNS]


def classify_parent_name(name: str) -> list[str]:
    """Return a list of reasons this parent name looks suspicious (empty if OK)."""
    reasons: list[str] = []
    if not name:
        reasons.append("empty name")
        return reasons
    if len(name) < 3:
        reasons.append(f"too short ({len(name)} chars)")
    for rx, reason in _BAD_PARENT_RE:
        if rx.search(name):
            reasons.append(reason)
    return reasons


async def main():
    await init_db()

    async with AsyncSessionLocal() as db:
        # Shape counts by status
        status_q = select(
            IngredientMaster.price_mapping_status,
            func.count(IngredientMaster.id),
        ).group_by(IngredientMaster.price_mapping_status)
        status_counts = dict((await db.execute(status_q)).all())
        total = sum(status_counts.values())

        parents_q = select(func.count(IngredientMaster.id)).where(
            IngredientMaster.parent_id.is_(None)
        )
        parents_n = (await db.execute(parents_q)).scalar() or 0

        variants_q = select(func.count(IngredientMaster.id)).where(
            IngredientMaster.parent_id.is_not(None)
        )
        variants_n = (await db.execute(variants_q)).scalar() or 0

        log.info("=" * 60)
        log.info(f"TOTAL INGREDIENTS: {total}")
        log.info(f"  parents (parent_id IS NULL):     {parents_n}")
        log.info(f"  variants (parent_id IS NOT NULL): {variants_n}")
        log.info("Status breakdown:")
        for st, n in sorted(status_counts.items(), key=lambda x: -x[1]):
            log.info(f"  {str(st or 'NULL'):<12} {n}")
        log.info("")

        # Load all parents (should be small-ish, a few hundred to a few thousand)
        parents_rows_q = (
            select(
                IngredientMaster.id,
                IngredientMaster.canonical_name,
                IngredientMaster.display_name_fr,
                IngredientMaster.price_mapping_status,
                IngredientMaster.category,
            )
            .where(IngredientMaster.parent_id.is_(None))
            .where(IngredientMaster.price_mapping_status != "invalid")
        )
        parents = list((await db.execute(parents_rows_q)).all())

        # --- Check 1: parent name quality ---
        bad_parents: list[dict] = []
        display_same_as_canonical = 0
        for pid, cn, dn, status, cat in parents:
            reasons = classify_parent_name(cn or "")
            # display_name_fr == mechanical variant of canonical_name
            mechanical = (cn or "").replace("_", " ").title()
            if dn and dn.strip().lower() == mechanical.strip().lower():
                display_same_as_canonical += 1
            if reasons:
                bad_parents.append({
                    "id": pid,
                    "canonical_name": cn,
                    "display_name_fr": dn,
                    "status": status,
                    "category": cat,
                    "reasons": reasons,
                })

        parent_anomaly_pct = 100 * len(bad_parents) / max(1, len(parents))
        log.info(f"PARENT NAME QUALITY  (n={len(parents)})")
        log.info(f"  suspicious:   {len(bad_parents)} ({parent_anomaly_pct:.1f}%)")
        log.info(f"  display_name == mechanical canonical: {display_same_as_canonical}")
        if bad_parents:
            log.info("  worst 20 samples:")
            for b in bad_parents[:20]:
                log.info(f"    [{b['id']}] {b['canonical_name']}  — {', '.join(b['reasons'])}")
        log.info("")

        # --- Check 2: variant integrity ---
        # Load all variants + their parents as a dict
        variants_rows_q = select(
            IngredientMaster.id,
            IngredientMaster.canonical_name,
            IngredientMaster.parent_id,
            IngredientMaster.price_mapping_status,
        ).where(IngredientMaster.parent_id.is_not(None))
        variants = list((await db.execute(variants_rows_q)).all())

        # Parent lookup table (id → (name, status, parent_id))
        all_rows_q = select(
            IngredientMaster.id,
            IngredientMaster.canonical_name,
            IngredientMaster.price_mapping_status,
            IngredientMaster.parent_id,
        )
        all_map = {
            r[0]: {"name": r[1], "status": r[2], "parent_id": r[3]}
            for r in (await db.execute(all_rows_q)).all()
        }

        variant_issues: list[dict] = []
        parent_counts: dict[int, int] = defaultdict(int)

        for vid, vname, pid, vstatus in variants:
            parent_counts[pid] += 1
            parent_info = all_map.get(pid)
            if parent_info is None:
                variant_issues.append({"id": vid, "name": vname, "parent_id": pid,
                                       "issue": "parent_id points at non-existent row"})
                continue
            if parent_info["status"] == "invalid":
                variant_issues.append({"id": vid, "name": vname, "parent_id": pid,
                                       "parent_name": parent_info["name"],
                                       "issue": "parent is invalid"})
            if parent_info["parent_id"] is not None:
                variant_issues.append({"id": vid, "name": vname, "parent_id": pid,
                                       "parent_name": parent_info["name"],
                                       "issue": "chained variant (parent is itself a variant)"})

        # Simple cycle check (depth > 3 means there's a cycle or deep chain)
        def chain_depth(iid: int, max_depth: int = 5) -> int:
            d = 0
            cur = iid
            seen = {cur}
            while d < max_depth:
                info = all_map.get(cur)
                if not info or info["parent_id"] is None:
                    return d
                cur = info["parent_id"]
                if cur in seen:
                    return max_depth  # cycle
                seen.add(cur)
                d += 1
            return d

        cyclic = [v for v in variants if chain_depth(v[0]) >= 5]
        for vid, vname, pid, _ in cyclic:
            variant_issues.append({"id": vid, "name": vname, "parent_id": pid,
                                   "issue": "chain depth >= 5 (cycle or over-chain)"})

        variant_anomaly_pct = 100 * len(variant_issues) / max(1, len(variants))
        log.info(f"VARIANT INTEGRITY  (n={len(variants)})")
        log.info(f"  issues:       {len(variant_issues)} ({variant_anomaly_pct:.2f}%)")
        if variant_issues:
            log.info("  first 15 issues:")
            for v in variant_issues[:15]:
                pname = v.get("parent_name", "?")
                log.info(f"    [{v['id']}] {v['name']} → parent [{v['parent_id']}:{pname}] — {v['issue']}")
        log.info("")

        # --- Check 3: biggest clusters ---
        biggest = sorted(parent_counts.items(), key=lambda x: -x[1])[:15]
        log.info("BIGGEST CLUSTERS  (by variant count)")
        for pid, n in biggest:
            pinfo = all_map.get(pid, {})
            log.info(f"  [{pid}] {pinfo.get('name', '?'):<30} × {n} variants")
        log.info("")

        # --- Check 4: random sample for human eyeballs ---
        log.info("RANDOM VARIANT SAMPLE  (20 variants + their parent)")
        if variants:
            sample = random.sample(variants, min(20, len(variants)))
            for vid, vname, pid, _ in sample:
                pinfo = all_map.get(pid, {})
                log.info(f"  {vname:<40} → {pinfo.get('name', '?')}")
        log.info("")

        # --- Join on RecipeIngredient to see usage stats ---
        usage_q = (
            select(IngredientMaster.id, func.count(RecipeIngredient.id))
            .outerjoin(RecipeIngredient, RecipeIngredient.ingredient_master_id == IngredientMaster.id)
            .group_by(IngredientMaster.id)
        )
        usage_map = dict((await db.execute(usage_q)).all())

        # Parents used in < 2 recipes AND no children = orphan candidates
        orphans: list[tuple[int, str, int]] = []
        for pid, cn, _, _, _ in parents:
            if parent_counts.get(pid, 0) == 0 and (usage_map.get(pid) or 0) < 2:
                orphans.append((pid, cn, usage_map.get(pid) or 0))
        log.info(f"ORPHAN PARENTS  (no variants + <2 recipe uses): {len(orphans)}")
        for pid, cn, uses in orphans[:10]:
            log.info(f"  [{pid}] {cn}  (uses={uses})")
        log.info("")

        # Write JSON report
        report = {
            "total": total,
            "parents": len(parents),
            "variants": len(variants),
            "status_counts": {str(k): v for k, v in status_counts.items()},
            "parent_anomaly_pct": round(parent_anomaly_pct, 2),
            "variant_anomaly_pct": round(variant_anomaly_pct, 2),
            "bad_parents": bad_parents[:200],
            "variant_issues": variant_issues[:200],
            "biggest_clusters": [
                {"parent_id": pid, "parent_name": all_map.get(pid, {}).get("name"), "variant_count": n}
                for pid, n in biggest
            ],
            "orphan_parents": [{"id": p[0], "name": p[1], "uses": p[2]} for p in orphans[:100]],
        }
        out = Path(__file__).resolve().parent.parent / "audit_results.json"
        out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        log.info(f"Full report written to {out}")

        # --- Pass/fail summary ---
        log.info("=" * 60)
        log.info("SUMMARY")
        log.info(f"  Parent anomalies:   {parent_anomaly_pct:.2f}%   (threshold <5%)")
        log.info(f"  Variant anomalies:  {variant_anomaly_pct:.2f}%   (threshold <2%)")
        ok = parent_anomaly_pct < 5 and variant_anomaly_pct < 2
        if ok:
            log.info("  => PASS — safe to proceed to mapping.")
            return 0
        else:
            log.info("  => FAIL — re-run the clustering with a tighter prompt, or fix anomalies manually.")
            return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
