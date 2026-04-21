"""Fix corrupted French display names that slipped through the Marmiton import.

Real examples of garbage we've seen:
- "Ousses D'Ail"     → "Gousses d'ail" (the leading 'G' was eaten by a quantity parser)
- "S De Safran"      → "Pincées de safran"
- "À Soupe D'Huile D'Olive" → "Cuillères à soupe d'huile d'olive"
- "Saucisses Fumées Type Diots De Savoie Ou 4 Saucisses De Montbéliard"
  → "Saucisses fumées"

Given the canonical_name (clean underscore form) and the corrupted
display_name_fr, asks Gemini to return a proper French title.
"""
import json
import logging
from app.ai.client import get_client
from app.config import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Tu es un expert culinaire francophone. Pour chaque ingrédient
ci-dessous, je te donne :
- `canonical`: le nom canonique standardisé (minuscule, underscores)
- `display`: le nom d'affichage actuel, potentiellement corrompu

Retourne un nom d'affichage français propre et naturel (Title Case doux,
sans quantité, sans préparation, sans « type de », sans doublons). Si le
display est déjà correct, renvoie-le tel quel.

Exemples :
- canonical="ail", display="Ousses D'Ail" → "Ail"
- canonical="safran", display="S De Safran" → "Safran"
- canonical="huile_olive", display="À Soupe D'Huile D'Olive" → "Huile d'olive"
- canonical="saucisses_fumees", display="Saucisses Fumées Type Diots De Savoie Ou 4 Saucisses De Montbéliard"
  → "Saucisses fumées"

Réponds UNIQUEMENT avec un JSON array de strings dans le même ordre que l'input."""


async def clean_display_names(
    pairs: list[tuple[str, str]],
) -> list[str]:
    """
    Args:
        pairs: list of (canonical_name, current_display_name).
    Returns:
        list of cleaned display names, same length/order as input.
        On failure: returns the original display names (no mutation).
    """
    if not pairs:
        return []

    client = get_client()
    items = [{"canonical": c, "display": d} for c, d in pairs]
    prompt = SYSTEM_PROMPT + f"\n\nInput: {json.dumps(items, ensure_ascii=False)}"

    try:
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=prompt,
        )
        text = response.text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)
        if isinstance(result, list) and len(result) == len(pairs):
            return [str(r).strip() for r in result]
    except Exception as e:
        logger.warning(f"Display name cleaner error: {e}")

    return [d for _, d in pairs]
