"""
Recipe AI classification: tags, meal_type, cuisine_type.
"""
import asyncio
import logging
from app.ai.client import get_client
from app.ai.utils import parse_gemini_json
from app.config import settings

logger = logging.getLogger(__name__)

CLASSIFY_PROMPT = """Tu es un expert culinaire. Analyse cette recette et réponds UNIQUEMENT avec un JSON valide
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
tags: liste libre de 2-5 mots-clés (ex: "rapide", "économique", "famille", "hivernal").
"""


async def classify_recipe(title: str, ingredients_text: str) -> dict:
    client = get_client()
    prompt = f"{CLASSIFY_PROMPT}\n\nRecette: {title}\nIngrédients: {ingredients_text}"

    for attempt in range(5):
        try:
            await asyncio.sleep(4)  # respect ~15 RPM free-tier limit
            response = client.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents=prompt,
            )
            return parse_gemini_json(response.text)
        except Exception as e:
            is_rate_limit = "429" in str(e) or "quota" in str(e).lower() or "rate" in str(e).lower()
            if attempt < 4:
                wait = min(60 * (2 ** attempt), 300) if is_rate_limit else 5
                logger.warning(f"Classifier attempt {attempt + 1}/5 for '{title}' failed ({e}), retrying in {wait}s")
                await asyncio.sleep(wait)
            else:
                logger.warning(f"Classifier failed after 5 attempts for '{title}': {e}")
    return {}


async def classify_ingredient(canonical_name: str) -> dict:
    """
    Returns: {category, subcategory, is_produce, default_unit}
    """
    client = get_client()
    prompt = (
        f"Catégorise l'ingrédient culinaire '{canonical_name}'. "
        "Réponds UNIQUEMENT avec un JSON: "
        '{"category":"fruit|legume|viande|poisson|laitier|epice|feculent|conserve|noix|autre",'
        '"subcategory":"string",'
        '"is_produce":true|false,'
        '"default_unit":"g|ml|unite"}'
    )
    try:
        response = client.models.generate_content(model=settings.GEMINI_MODEL, contents=prompt)
        return parse_gemini_json(response.text)
    except Exception as e:
        logger.warning(f"Ingredient classifier error for '{canonical_name}': {e}")
        return {"category": "autre", "subcategory": None, "is_produce": False, "default_unit": "g"}
