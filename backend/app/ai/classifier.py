"""Recipe + ingredient + match-validation AI calls, via Claude."""
import asyncio
import json
import logging
from app.ai.client import call_claude
from app.ai.utils import parse_json_response

logger = logging.getLogger(__name__)

CLASSIFY_SYSTEM = """Tu es un expert culinaire. Analyse la recette fournie et réponds UNIQUEMENT avec un JSON valide
(pas de markdown, pas d'explication) avec ces champs:
{
  "meal_type": "entree|plat|dessert|snack",
  "is_sweet": true|false,
  "is_salty": true|false,
  "is_spicy": true|false,
  "is_vegetarian": true|false,
  "is_vegan": true|false,
  "cuisine_type": "francais|italien|asiatique|mexicain|americain|moyen_orient|autre",
  "tags": ["tag1", "tag2"],
  "health_score": 0.0-10.0
}

health_score: 10=très sain (légumes, protéines maigres), 1=très calorique/gras.
tags: liste libre de 2-5 mots-clés (ex: "rapide", "économique", "famille", "hivernal")."""


async def classify_recipe(title: str, ingredients_text: str) -> dict:
    user = f"Recette: {title}\nIngrédients: {ingredients_text}"

    for attempt in range(3):
        try:
            text = await call_claude(CLASSIFY_SYSTEM, user)
            return parse_json_response(text)
        except Exception as e:
            if attempt < 2:
                wait = 5 * (2 ** attempt)
                logger.warning(f"Classifier attempt {attempt + 1}/3 for '{title}' failed ({e}), retrying in {wait}s")
                await asyncio.sleep(wait)
            else:
                logger.warning(f"Classifier failed after 3 attempts for '{title}': {e}")
    return {}


VALIDATE_MATCH_SYSTEM = """Tu es un expert en épicerie québécoise.
Pour chaque paire (ingrédient_canonique, nom_produit_en_rayon), dis si le produit est bien
une instance acceptable de l'ingrédient pour une liste d'épicerie.

Réponds UNIQUEMENT avec un JSON array de float entre 0.0 et 1.0 (même ordre que l'input).
1.0 = match parfait, 0.0 = produit complètement différent.
Seuil d'acceptation recommandé : 0.75.

Exemples :
("huile_olive", "Huile d'olive extra vierge 500ml") → 1.0
("sel", "Sel de mer fin iodé 500g") → 0.9
("sel_rose_himalaya", "Sel de mer fin iodé 500g") → 0.2
("parmesan", "Parmigiano Reggiano râpé 200g") → 0.95
("beurre", "Margarine végétale 454g") → 0.1
("boeuf_hache", "Bœuf haché extra-maigre 500g") → 0.98"""


async def validate_store_matches(pairs: list[tuple[str, str]]) -> list[float]:
    """Returns a confidence score [0.0–1.0] for each (canonical, product_name) pair.
    Batches up to 30 pairs per request. Falls back to 0.5 on error.
    """
    if not pairs:
        return []

    scores: list[float] = [0.5] * len(pairs)
    batch_size = 30

    for chunk_start in range(0, len(pairs), batch_size):
        chunk = pairs[chunk_start: chunk_start + batch_size]
        payload = [{"ingredient": c, "product": p} for c, p in chunk]
        user = f"Input: {json.dumps(payload, ensure_ascii=False)}"

        for attempt in range(3):
            try:
                text = await call_claude(VALIDATE_MATCH_SYSTEM, user)
                result = parse_json_response(text)
                if isinstance(result, list) and len(result) == len(chunk):
                    for i, score in enumerate(result):
                        try:
                            scores[chunk_start + i] = max(0.0, min(1.0, float(score)))
                        except (TypeError, ValueError):
                            pass
                    break
                raise ValueError(f"Expected list of {len(chunk)}, got {result}")
            except Exception as e:
                if attempt < 2:
                    wait = 3 * (2 ** attempt)
                    logger.warning(f"validate_store_matches attempt {attempt + 1}/3 failed ({e}), retrying in {wait}s")
                    await asyncio.sleep(wait)
                else:
                    logger.warning(f"validate_store_matches failed for chunk, using fallback 0.5: {e}")

    return scores


CLASSIFY_INGREDIENT_SYSTEM = """Catégorise l'ingrédient culinaire fourni. Réponds UNIQUEMENT avec un JSON:
{"category":"fruit|legume|viande|poisson|laitier|epice|feculent|conserve|noix|autre",
"subcategory":"string",
"is_produce":true|false,
"default_unit":"g|ml|unite"}"""


async def classify_ingredient(canonical_name: str) -> dict:
    try:
        text = await call_claude(CLASSIFY_INGREDIENT_SYSTEM, f"Ingrédient: {canonical_name}")
        return parse_json_response(text)
    except Exception as e:
        logger.warning(f"Ingredient classifier error for '{canonical_name}': {e}")
        return {"category": "autre", "subcategory": None, "is_produce": False, "default_unit": "g"}
