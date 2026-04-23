"""Refactor the IngredientMaster table into a 2-tier hierarchy.

Every existing ingredient becomes either:
  * a **canonical parent**  — a real grocery product ("thon", "beurre",
    "huile d'olive"). These carry the price + image. One of the surviving
    rows is promoted; a new row is created if none of the input names is
    itself a clean canonical.
  * a **variant** — points at its parent via `parent_id`. Holds the
    recipe-specific form ("boîte de thon 200g", "beurre fondu"). No price
    of its own; inherits from parent.
  * **invalid** — fragments and non-ingredients ("au_goût",
    "sel_et_poivre", "es"). `price_mapping_status = 'invalid'`,
    `parent_id = NULL`. Never scraped.

How the mapping is produced:
  1. Load every IngredientMaster (12 k rows).
  2. Batch 40 names / Gemini call. Each response is a JSON object:
       { "parent": "beurre" | null, "invalid": false,
         "search_query": "beurre demi-sel", "category": "produit_laitier" }
     `parent=null` means THIS row itself is the canonical.
  3. Cluster rows sharing the same parent name.
  4. For each cluster, pick (or create) the canonical row. Promote it
     (set price_mapping_status = 'pending', clear parent_id, set a clean
     display_name_fr and category). Re-parent the rest of the cluster.
  5. Flag invalid rows.

Re-run safe. Pass --dry to preview without writing.
Pass --limit=N to restrict to the N most-used ingredients (for quick tests).
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select, update, func, delete

from app.database import AsyncSessionLocal, init_db
from app.models.ingredient import IngredientMaster
from app.models.recipe import RecipeIngredient
from app.ai.client import call_claude
from app.ai.utils import parse_json_response

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

BATCH = 15  # Gemini 3 Flash Preview truncates JSON past ~800 chars — keep responses short
# Gemini responses are highly variable (5s to 60s per call). High concurrency
# hides the slow responses so overall throughput stays near throttle-limited.
CONCURRENCY = 15
DRY = "--dry" in sys.argv
LIMIT = next((int(a.split("=", 1)[1]) for a in sys.argv if a.startswith("--limit=")), None)


SYSTEM = """Tu normalises des noms d'ingrédients extraits de recettes. Chaque input
est un nom avec underscores. Retourne pour chacun un JSON avec:

  "parent"        : le nom canonique de l'ingrédient brut en français québécois,
                    minuscules, avec accents, SANS underscores, SANS préfixe de
                    quantité/emballage/coupe. Par exemple:
                      "boite_de_thon_200g"    → "thon"
                      "beurre_fondu"          → "beurre"
                      "huile_olive_extra_vierge" → "huile d'olive"
                      "sachet_de_levure_chimique" → "levure chimique"
                      "chou_fleur_cru"        → "chou-fleur"
                    Si l'input EST DÉJÀ un nom canonique propre, retourne-le
                    tel quel en français lisible:
                      "ail"        → "ail"
                      "tomate"     → "tomate"
                    Deux formes qui désignent LE MÊME produit en épicerie
                    partagent le MÊME parent (beurre_fondu, beurre_ramolli,
                    beurre_doux → "beurre"). Deux produits distincts chez
                    Maxi ont des parents distincts (beurre_demi_sel vs beurre).

  "invalid"       : true si l'input n'est PAS un vrai ingrédient (fragment de
                    mesure "à_soupe_de", "au_gout", "es", composé "sel_et_poivre").
                    false sinon.

  "search_query"  : si parent n'est pas null, une chaîne courte lisible en
                    français pour chercher ce produit sur maxi.ca, avec accents,
                    sans underscores. Peut être identique à parent.

  "category"      : une de: "fruit", "legume", "viande", "poisson", "produit_laitier",
                    "cereale", "epice", "condiment", "boisson", "noix",
                    "conserve", "autre".

Exemples:
  "huile_olive"                 → {"parent":"huile d'olive","invalid":false,"search_query":"huile d'olive","category":"condiment"}
  "beurre_fondu"                → {"parent":"beurre","invalid":false,"search_query":"beurre","category":"produit_laitier"}
  "boite_de_thon_200g"          → {"parent":"thon","invalid":false,"search_query":"thon en conserve","category":"conserve"}
  "sel_et_poivre"               → {"parent":"sel","invalid":false,"search_query":"sel","category":"epice"}
  "au_gout"                     → {"parent":null,"invalid":true,"search_query":null,"category":"autre"}
  "a_soupe_de_creme"            → {"parent":"crème liquide","invalid":false,"search_query":"crème liquide","category":"produit_laitier"}
  "ousses_dail"                 → {"parent":"ail","invalid":false,"search_query":"ail","category":"legume"}

Réponds UNIQUEMENT avec un JSON array d'objets, dans le MÊME ordre que l'input."""


def _slug(s: str) -> str:
    s = (s or "").lower().strip()
    s = s.replace("'", "").replace("'", "").replace("ʼ", "")
    s = re.sub(r"[\s\-.,/]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s


async def classify_batch(names: list[str]) -> list[dict]:
    user = f"Input: {json.dumps(names, ensure_ascii=False)}"
    for attempt in range(3):
        try:
            text = await call_claude(SYSTEM, user)
            parsed = parse_json_response(text)
            if isinstance(parsed, list) and len(parsed) == len(names):
                return [p if isinstance(p, dict) else {} for p in parsed]
            raise ValueError(f"len {len(parsed)} vs {len(names)}")
        except Exception as e:
            if attempt < 2:
                await asyncio.sleep(5 * (2 ** attempt))
                logging.warning(f"classify retry ({e})")
            else:
                logging.warning(f"classify FAILED: {e}")
    return [{}] * len(names)


async def main():
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
        if LIMIT:
            q = q.limit(LIMIT)
        rows = (await db.execute(q)).all()
    logging.info(f"{len(rows)} ingredients to process")

    # Call Gemini in batches, CONCURRENCY batches in flight at a time.
    # The internal _throttle() lock still caps global rate to ~10 RPM, so we
    # won't trip the free-tier limit even with several workers.
    decisions: dict[int, dict] = {}
    total = len(rows)
    done = 0
    sem = asyncio.Semaphore(CONCURRENCY)

    async def run_chunk(chunk):
        nonlocal done
        async with sem:
            names = [r[1] for r in chunk]
            results = await classify_batch(names)
            for (iid, _cn, _dn, _cat, _uses), res in zip(chunk, results):
                decisions[iid] = res
            done += len(chunk)
            logging.info(f"classified {done}/{total}")

    chunks = [rows[s : s + BATCH] for s in range(0, total, BATCH)]
    await asyncio.gather(*(run_chunk(c) for c in chunks))

    # Phase 2: cluster by parent name
    by_parent: dict[str, list] = defaultdict(list)
    invalid_ids: list[int] = []
    unclassified: list[int] = []
    for (iid, cn, dn, cat, uses) in rows:
        d = decisions.get(iid) or {}
        if d.get("invalid"):
            invalid_ids.append(iid)
            continue
        parent_name = (d.get("parent") or "").strip()
        if not parent_name:
            unclassified.append(iid)
            continue
        parent_slug = _slug(parent_name)
        by_parent[parent_slug].append((iid, cn, parent_name, d.get("search_query") or parent_name, d.get("category") or cat, uses))

    logging.info(f"clusters: {len(by_parent)}  invalid: {len(invalid_ids)}  unclassified: {len(unclassified)}")
    for ps, members in sorted(by_parent.items(), key=lambda x: -len(x[1]))[:20]:
        logging.info(f"  [{len(members):>3}] {ps} — sample: {members[0][1][:40]}")

    if DRY:
        logging.info("--dry: no DB writes.")
        return

    # Phase 3: apply
    async with AsyncSessionLocal() as db:
        # 3a. Mark invalid
        if invalid_ids:
            await db.execute(
                update(IngredientMaster)
                .where(IngredientMaster.id.in_(invalid_ids))
                .values(price_mapping_status="invalid", parent_id=None)
            )
            logging.info(f"  marked {len(invalid_ids)} as invalid")

        # 3b. For each cluster, pick/promote a canonical row
        for ps, members in by_parent.items():
            if not members:
                continue
            # Prefer a member whose canonical_name already equals the parent_slug
            canonical_row = next((m for m in members if _slug(m[1]) == ps), None)
            if canonical_row is None:
                # Pick the most-used member as the canonical
                members.sort(key=lambda m: -m[5])
                canonical_row = members[0]

            iid = canonical_row[0]
            parent_display = canonical_row[2]
            search_q = canonical_row[3]
            cat = canonical_row[4]

            # Promote the canonical
            await db.execute(
                update(IngredientMaster)
                .where(IngredientMaster.id == iid)
                .values(
                    canonical_name=ps,
                    display_name_fr=search_q,
                    category=cat,
                    parent_id=None,
                    price_mapping_status="pending",
                )
            )

            # Re-parent the rest of the cluster
            child_ids = [m[0] for m in members if m[0] != iid]
            if child_ids:
                await db.execute(
                    update(IngredientMaster)
                    .where(IngredientMaster.id.in_(child_ids))
                    .values(parent_id=iid, price_mapping_status="variant")
                )
        await db.commit()
        logging.info("DB updates committed")


if __name__ == "__main__":
    asyncio.run(main())
