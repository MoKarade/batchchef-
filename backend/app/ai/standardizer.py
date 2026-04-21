"""
Batch-standardize raw ingredient names to canonical form.
Sends up to 50 names per Gemini request.
Returns structured results: {"canonical": str, "variant": str | None}
  - canonical = Level-1 generic name (e.g. "thon", "ail")
  - variant   = Level-2 specific form when a container/preparation is detected
                (e.g. "thon_en_boite", "ail_en_poudre"), else null
"""
import json
import logging
import re
from app.ai.client import get_client
from app.config import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Tu es un expert culinaire. Pour chaque ingrédient brut reçu, retourne un objet JSON avec :
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
    """
    Returns StandardizeResult for each raw_name.
    Falls back to basic cleaning if AI fails.
    """
    if not raw_names:
        return []

    client = get_client()
    prompt = SYSTEM_PROMPT + f"\n\nInput: {json.dumps(raw_names, ensure_ascii=False)}"

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
    except Exception as e:
        logger.warning(f"Standardizer error: {e}")

    return [StandardizeResult(_basic_clean(n)) for n in raw_names]


def _sanitize_canonical(c: str) -> str:
    """Defense-in-depth: remove leading digits/dashes Gemini may hallucinate."""
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
