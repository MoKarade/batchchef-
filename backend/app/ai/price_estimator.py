"""Estimate Fruiterie 440 (Montréal) average prices for ingredients via Claude."""
import asyncio
import json
import logging
from app.ai.client import call_claude
from app.ai.utils import parse_json_response

logger = logging.getLogger(__name__)

PRICE_SYSTEM = """Tu es un expert des prix alimentaires au Québec en 2026.
Pour chaque ingrédient de la liste, estime le prix moyen observé à la
Fruiterie 440 (fruiterie indépendante à Montréal).

Règles:
- Fruits/légumes/produits vrac: prix en $/kg.
- Œufs, pain, boîtes conserve, etc.: prix par unité standard (douzaine d'œufs,
  pain 675 g, boîte 398 ml...).
- Si l'ingrédient n'est pas habituellement vendu en fruiterie (viandes de
  boucher, produits transformés rares), retourne quand même une estimation
  raisonnable avec confidence plus basse.

Réponds UNIQUEMENT en JSON (array d'objets, même ordre que l'input):
[
  {"canonical_name": "...", "price": 3.49, "unit": "kg|unite|g|L|ml", "format_qty": 1.0, "confidence": 0.0-1.0}
]"""


async def estimate_prices_batch(canonical_names: list[str]) -> list[dict]:
    """Returns list of dicts: {canonical_name, price, unit, format_qty, confidence}.
    Entries with missing data or confidence < 0.3 are filtered out.
    """
    if not canonical_names:
        return []

    readable = [n.replace("_", " ") for n in canonical_names]
    user = f"Input: {json.dumps(readable, ensure_ascii=False)}"
    result = None

    for attempt in range(3):
        try:
            text = await call_claude(PRICE_SYSTEM, user)
            result = parse_json_response(text)
            if not isinstance(result, list):
                raise ValueError("Expected a JSON array")
            if len(result) != len(canonical_names):
                raise ValueError(f"Length mismatch: got {len(result)}, expected {len(canonical_names)}")
            break
        except Exception as e:
            if attempt < 2:
                wait = 5 * (2 ** attempt)
                logger.warning(f"Price estimator attempt {attempt + 1}/3 failed ({e}), retrying in {wait}s")
                await asyncio.sleep(wait)
            else:
                logger.warning(f"Price estimator failed after 3 attempts: {e}")
                return []

    out: list[dict] = []
    for canon, entry in zip(canonical_names, result or []):
        if not isinstance(entry, dict):
            continue
        price = entry.get("price")
        confidence = entry.get("confidence", 0)
        if price is None or not isinstance(price, (int, float)) or price <= 0:
            continue
        try:
            confidence = float(confidence)
        except (TypeError, ValueError):
            confidence = 0
        if confidence < 0.3:
            continue
        unit = (entry.get("unit") or "kg").lower()
        try:
            format_qty = float(entry.get("format_qty") or 1.0)
        except (TypeError, ValueError):
            format_qty = 1.0
        out.append({
            "canonical_name": canon,
            "price": float(price),
            "unit": unit,
            "format_qty": format_qty,
            "confidence": confidence,
        })
    return out
