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
import asyncio
import json
import logging
from app.ai.client import get_client
from app.ai.utils import parse_gemini_json
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

    for attempt in range(5):
        try:
            await asyncio.sleep(4)
            response = client.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents=prompt,
            )
            result = parse_gemini_json(response.text)
            if isinstance(result, list) and len(result) == len(pairs):
                return [str(r).strip() for r in result]
            raise ValueError(f"Length mismatch: got {len(result)}, expected {len(pairs)}")
        except Exception as e:
            is_rate_limit = "429" in str(e) or "quota" in str(e).lower() or "rate" in str(e).lower()
            if attempt < 4:
                wait = min(60 * (2 ** attempt), 300) if is_rate_limit else 5
                logger.warning(f"Display name cleaner attempt {attempt + 1}/5 failed ({e}), retrying in {wait}s")
                await asyncio.sleep(wait)
            else:
                logger.warning(f"Display name cleaner failed after 5 attempts: {e}")

    return [d for _, d in pairs]
