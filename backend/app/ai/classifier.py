"""
Recipe AI classification: tags, meal_type, cuisine_type.
"""
import json
import logging
from app.ai.client import get_client
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
    try:
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=prompt,
        )
        text = response.text.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])
        return json.loads(text)
    except Exception as e:
        logger.warning(f"Classifier error for '{title}': {e}")
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
        return json.loads(response.text.strip())
    except Exception as e:
        logger.warning(f"Ingredient classifier error for '{canonical_name}': {e}")
        return {"category": "autre", "subcategory": None, "is_produce": False, "default_unit": "g"}
