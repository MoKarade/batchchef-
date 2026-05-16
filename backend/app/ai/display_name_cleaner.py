"""Fix corrupted French display names via Claude."""
import asyncio
import json
import logging
from app.ai.client import call_claude
from app.ai.utils import parse_json_response

logger = logging.getLogger(__name__)

CLEANER_SYSTEM = """Tu es un expert culinaire francophone. Pour chaque ingrédient,
je te donne :
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


async def clean_display_names(pairs: list[tuple[str, str]]) -> list[str]:
    """pairs: list of (canonical_name, current_display_name). Returns cleaned display names."""
    if not pairs:
        return []

    items = [{"canonical": c, "display": d} for c, d in pairs]
    user = f"Input: {json.dumps(items, ensure_ascii=False)}"

    for attempt in range(3):
        try:
            text = await call_claude(CLEANER_SYSTEM, user)
            result = parse_json_response(text)
            if isinstance(result, list) and len(result) == len(pairs):
                return [str(r).strip() for r in result]
            raise ValueError(f"Length mismatch: got {len(result)}, expected {len(pairs)}")
        except Exception as e:
            if attempt < 2:
                wait = 5 * (2 ** attempt)
                logger.warning(f"Display name cleaner attempt {attempt + 1}/3 failed ({e}), retrying in {wait}s")
                await asyncio.sleep(wait)
            else:
                logger.warning(f"Display name cleaner failed after 3 attempts: {e}")

    return [d for _, d in pairs]
