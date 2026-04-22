"""
Batch-standardize raw ingredient names to canonical form via Claude.
Sends up to 50 names per request.
"""
import json
import logging
import re
from app.ai.client import call_claude
from app.ai.utils import parse_json_response

logger = logging.getLogger(__name__)

_ALIASES_BATCH = 50

STANDARDIZE_SYSTEM = """Tu es un expert culinaire. Pour chaque ingrédient brut reçu, retourne un objet JSON avec :
- "canonical" : le nom générique de l'ingrédient (Level-1), singulier, sans adjectif, sans quantité, sans conditionnement.
- "variant" : null OU le nom plus spécifique (Level-2) quand l'ingrédient est clairement dans une forme/conditionnement distinct.

Règles strictes :
- JAMAIS de chiffres, tirets, signes ou quantités dans les noms.
- Minuscules uniquement. Accents conservés.
- Underscores pour les noms composés.
- "canonical" = forme la plus générique ("ail", "thon", "levure").
- "variant" seulement si le conditionnement/préparation change le produit (conserve, surgelé, poudre, fumé, salé, en pot…).

Exemples de variants à détecter :
"1 boîte de thon"           → {"canonical":"thon","variant":"thon_en_boite"}
"sachet de levure chimique" → {"canonical":"levure_chimique","variant":"levure_chimique_sachet"}
"poitrine fumée"            → {"canonical":"poitrine_porc","variant":"poitrine_fumee"}
"ail en poudre"             → {"canonical":"ail","variant":"ail_en_poudre"}
"tomates pelées en conserve"→ {"canonical":"tomate","variant":"tomate_en_conserve"}
"saumon fumé"               → {"canonical":"saumon","variant":"saumon_fume"}
"beurre salé"               → {"canonical":"beurre","variant":"beurre_sale"}

Exemples SANS variant (forme par défaut) :
"2 gousses d'ail haché"     → {"canonical":"ail","variant":null}
"- 1 noix de beurre"        → {"canonical":"beurre","variant":null}
"huile d'olive vierge extra"→ {"canonical":"huile_olive","variant":null}
"pommes de terre à chair ferme" → {"canonical":"pomme_de_terre","variant":null}
"134 oeufs"                 → {"canonical":"oeuf","variant":null}

Réponds UNIQUEMENT avec un JSON array d'objets dans le même ordre que l'input."""


class StandardizeResult:
    __slots__ = ("canonical", "variant")

    def __init__(self, canonical: str, variant: str | None = None):
        self.canonical = canonical
        self.variant = variant


async def standardize_batch(raw_names: list[str]) -> list[StandardizeResult]:
    """Returns StandardizeResult for each raw_name. Retries up to 3 times, falls back to basic cleaning."""
    if not raw_names:
        return []

    user = f"Input: {json.dumps(raw_names, ensure_ascii=False)}"

    for attempt in range(3):
        try:
            text = await call_claude(STANDARDIZE_SYSTEM, user)
            result = parse_json_response(text)
            if isinstance(result, list) and len(result) == len(raw_names):
                out = []
                for r in result:
                    if isinstance(r, dict):
                        canonical = _sanitize_canonical(str(r.get("canonical", "")))
                        raw_variant = r.get("variant")
                        variant = _sanitize_canonical(str(raw_variant)) if raw_variant else None
                        if variant == canonical:
                            variant = None
                        out.append(StandardizeResult(canonical, variant))
                    else:
                        out.append(StandardizeResult(_sanitize_canonical(str(r))))
                return out
            raise ValueError(f"Unexpected response length: {len(result)} vs {len(raw_names)}")
        except Exception as e:
            if attempt < 2:
                wait = 5 * (2 ** attempt)
                logger.warning(f"Standardizer attempt {attempt + 1}/3 failed ({e}), retrying in {wait}s")
                await asyncio.sleep(wait)
            else:
                logger.warning(f"Standardizer failed after 3 attempts: {e}")

    return [StandardizeResult(_basic_clean(n)) for n in raw_names]


ALIASES_SYSTEM = """Tu es un expert des épiceries québécoises (Maxi, Costco, IGA).
Pour chaque ingrédient culinaire reçu (sous forme de canonical_name avec underscores),
génère exactement 3 alias de recherche en français québécois pour trouver ce produit en épicerie.

Règles :
- Alias 1 : forme correcte avec accents (ex. "bœuf haché")
- Alias 2 : synonyme ou nom commercial courant au Québec (ex. "ground beef", "steak haché")
- Alias 3 : forme abrégée ou variante packaging typique (ex. "boeuf haché maigre")
- Toujours en minuscules. Jamais d'underscores dans les alias.
- Si l'ingrédient est déjà simple (ex. "sel", "eau"), donne 3 variantes utiles quand même.

Exemples :
"boeuf_hache" → ["bœuf haché", "ground beef", "boeuf haché maigre"]
"huile_olive"  → ["huile d'olive", "olive oil", "huile olive extra vierge"]
"tomate"       → ["tomate", "tomatoes", "tomates fraîches"]
"lait_entier"  → ["lait entier", "whole milk", "lait 3.25%"]

Réponds UNIQUEMENT avec un JSON object où chaque clé est le canonical_name d'input
et la valeur est un array de 3 strings."""


async def generate_search_aliases(canonical_names: list[str]) -> dict[str, list[str]]:
    """Generates 3 search aliases per canonical ingredient name, batched 50/request."""
    if not canonical_names:
        return {}

    result: dict[str, list[str]] = {}

    for chunk_start in range(0, len(canonical_names), _ALIASES_BATCH):
        chunk = canonical_names[chunk_start: chunk_start + _ALIASES_BATCH]
        user = f"Input: {json.dumps(chunk, ensure_ascii=False)}"

        for attempt in range(3):
            try:
                text = await call_claude(ALIASES_SYSTEM, user)
                parsed = parse_json_response(text)
                if isinstance(parsed, dict):
                    for name in chunk:
                        aliases = parsed.get(name, [])
                        if isinstance(aliases, list) and aliases:
                            result[name] = [str(a) for a in aliases[:3] if a]
                    break
                raise ValueError(f"Expected dict, got {type(parsed)}")
            except Exception as e:
                if attempt < 2:
                    wait = 5 * (2 ** attempt)
                    logger.warning(f"Aliases attempt {attempt + 1}/3 failed ({e}), retrying in {wait}s")
                    await asyncio.sleep(wait)
                else:
                    logger.warning(f"Aliases generation failed for chunk after 3 attempts: {e}")

    # Fallback: generate basic alias from canonical_name itself
    for name in canonical_names:
        if name not in result:
            result[name] = [name.replace("_", " ")]

    return result


def _sanitize_canonical(c: str) -> str:
    """Defense-in-depth: remove leading digits/dashes Claude may hallucinate."""
    c = c.lower().strip()
    c = re.sub(r"^[\s\-_\d,./]+", "", c)
    c = re.sub(r"_+", "_", c).strip("_ ")
    c = re.sub(r"\s+", "_", c)
    return c or "ingredient_inconnu"


def _basic_clean(name: str) -> str:
    name = name.lower().strip()
    name = re.sub(r"^-?\d+[\d/.,]*\s*", "", name)
    for noise in ["haché", "émincé", "pelé", "frais", "fraîche", "cuit", "cuite",
                  "vierge extra", "extra vierge", "à chair ferme"]:
        name = name.replace(noise, "")
    name = re.sub(r"\s+", "_", name.strip())
    return _sanitize_canonical(name)
