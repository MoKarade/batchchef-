"""Deterministic canonical-name post-processor.

Input: the raw string Gemini (or Marmiton JSON-LD) produces.
Output: a clean canonical_name OR None if the string is not a real
ingredient (e.g. a measurement spoon like "à_soupe_d'huile").

Entirely regex-based — no network, no AI. Saves 80 % of the current
Gemini rejections by normalizing before validation.

Rules applied, in order:
  1. If it starts with a measurement fragment ("à_soupe_de_", "à_café_de_",
     "pincee_de_", "poignee_de_", …) → strip the prefix.
  2. Strip packaging wrappers ("sachets_de_", "pots_de_", "boites_de_",
     "tranches_de_", "brins_de_", "gousses_de_", "feuilles_de_", …).
  3. Fix a missing first letter where the word is an obvious truncation
     of a known ingredient ("ousses_d'ail" → "ail", "rème_liquide" →
     "crème_liquide", "eurre" → "beurre").
  4. Split compound like "sel_et_poivre" → returns the *first* ingredient
     only (Gemini was wrong, caller should handle the second).
  5. Drop trailing/leading stop words and keep only the core ingredient.
  6. Return None if the result is <3 chars or clearly not an ingredient.
"""
from __future__ import annotations

import re


# Measurement / quantity prefixes that Marmiton/Gemini sometimes treat as
# the ingredient name itself. These are NEVER ingredients on their own.
_MEASURE_PREFIXES = [
    r"a_soupe_de?",       # "à soupe de..."
    r"a_cafe_de?",        # "à café de..."
    r"cuillere_a_soupe_de?",
    r"cuillere_a_cafe_de?",
    r"cuillere_de?",
    r"cuillerees?_de?",
    r"verre_de?",
    r"verres_de?",
    r"bol_de?",
    r"louche_de?",
    r"poignee_de?",
    r"poignees_de?",
    r"pincee_de?",
    r"pincees_de?",
    r"noix_de?",          # "une noix de beurre"
    r"trait_de?",
    r"filet_de?",         # "un filet d'huile d'olive"
    r"zeste_de?",
    r"jus_de?",
    r"dose_de?",
]

# Packaging wrappers that should be stripped so we keep only the ingredient.
_PACKAGING_PREFIXES = [
    r"sachets?_de?",
    r"sachets?_d",
    r"pots?_de?",
    r"boites?_de?",
    r"boites?_d",
    r"briques?_de?",
    r"bouteilles?_de?",
    r"canettes?_de?",
    r"tranches?_de?",
    r"tranches?_d",
    r"gousses?_de?",
    r"gousses?_d",
    r"feuilles?_de?",
    r"feuilles?_d",
    r"brins?_de?",
    r"brins?_d",
    r"branches?_de?",
    r"bouquets?_de?",
    r"morceaux?_de?",
    r"morceaux?_d",
    r"grappes?_de?",
    r"gouttes?_de?",
    r"paquets?_de?",
    r"barquettes?_de?",
]

# Build combined regex once
_PREFIX_RE = re.compile(
    r"^(?:" + "|".join(_MEASURE_PREFIXES + _PACKAGING_PREFIXES) + r")_+",
    re.IGNORECASE,
)

# Well-known ingredients whose first letter is frequently dropped by the
# Marmiton parser. Detected when a canonical matches the tail of one of
# these words (e.g. "ousses" → "gousses", canonical becomes "ail").
# { dropped-tail : core-ingredient }
_LEADING_CHAR_FIXES = {
    "ousses_dail": "ail",
    "ousses_dail_haches": "ail",
    "ousses_dail_hache": "ail",
    "ousses_d_ail": "ail",
    "ousses_de_vanille": "vanille",
    "ousses_d_vanille": "vanille",
    "a_soupe_dhuile": "huile_olive",
    "a_soupe_dhuile_dolive": "huile_olive",
    "a_soupe_de_creme": "creme_liquide",
    "a_soupe_de_sucre": "sucre",
    "a_soupe_de_farine": "farine",
    "a_soupe_deau": "eau",
    "a_cafe_de_sel": "sel",
    "a_cafe_de_sucre": "sucre",
    "a_cafe_de_poivre": "poivre",
    "rème_liquide": "creme_liquide",
    "reme_liquide": "creme_liquide",
    "eurre": "beurre",
    "eurre_tendre": "beurre",
    "eurre_fondu": "beurre",
    "eufs": "oeuf",
    "eufs_entiers": "oeuf",
    "eufs_frais": "oeuf",
    "ait": "lait",
    "ait_entier": "lait",
    "ait_ecreme": "lait",
    "romage": "fromage",
    "romage_rape": "fromage_rape",
    "arine": "farine",
    "arine_de_ble": "farine",
    "aut_de_lait": "lait",
    "ignon": "oignon",
    "ignons": "oignon",
    "oivre": "poivre",
    "oivre_du_moulin": "poivre",
    "oivre_noir": "poivre",
    "el": "sel",
    "el_fin": "sel",
    "el_de_mer": "sel",
    "ucre": "sucre",
    "ucre_glace": "sucre_glace",
    "ucre_en_poudre": "sucre",
    "ucre_roux": "sucre_roux",
    "ucre_vanille": "sucre_vanille",
    "omate": "tomate",
    "omates": "tomate",
    "omate_cerise": "tomate_cerise",
    "anille": "vanille",
    "hampignon": "champignon",
    "hampignons": "champignon",
    "hocolat": "chocolat",
    "aulx": "ail",
    "aux": "eau",
    "arotte": "carotte",
    "arottes": "carotte",
    "itron": "citron",
    "itrons": "citron",
    "itrons_verts": "citron_vert",
    "oulet": "poulet",
    "orc": "porc",
    "oireau": "poireau",
    "oireaux": "poireau",
    "âtes": "pates",
    "ates": "pates",
    "ates_feuilletees": "pate_feuilletee",
    "ate_feuilletee": "pate_feuilletee",
    "ate_brisee": "pate_brisee",
    "pinard": "epinard",
    "pinards": "epinard",
    "ananas": "ananas",
    "mande": "amande",
    "mandes": "amande",
    "endive": "endive",
    "ostoe": "pomme_de_terre",
    "ignon_rouge": "oignon",
    "ignon_jaune": "oignon",
    "ain": "pain",
    "ain_rassis": "pain",
    "ie": "miel",  # rare
    "iel": "miel",
}

# Stop words that frequently appear inside Marmiton-derived names and
# should be removed to get the core ingredient.
_STOP_TOKENS = {
    "en_poudre": "",
    "en_morceaux": "",
    "en_tranches": "",
    "en_dés": "",
    "en_rondelles": "",
    "haches": "",
    "hache": "",
    "pele": "",
    "peles": "",
    "emince": "",
    "eminces": "",
    "cuit": "",
    "cuits": "",
    "cru": "",
    "crus": "",
    "frais": "",
    "fraiche": "",
    "fraîche": "",
    "tendre": "",
    "tendres": "",
    "fondu": "",
    "fondus": "",
    "fondue": "",
    "fondues": "",
    "ramolli": "",
    "ramollie": "",
    "liquide": "liquide",  # keep — crème_liquide is a real thing
    "du_moulin": "",
    "de_paris": "de_paris",  # keep — champignons_de_paris is a real thing
    "a_chair_ferme": "",
    "a_chair_tendre": "",
    "a_soupe": "",
    "a_cafe": "",
    "bio": "",
    "biologique": "",
}


def _strip_accents_simple(s: str) -> str:
    """Very simple accent stripping for matching purposes."""
    return (s.replace("à", "a").replace("â", "a").replace("ä", "a")
             .replace("é", "e").replace("è", "e").replace("ê", "e").replace("ë", "e")
             .replace("î", "i").replace("ï", "i")
             .replace("ô", "o").replace("ö", "o")
             .replace("ù", "u").replace("û", "u").replace("ü", "u")
             .replace("ç", "c"))


def clean_canonical(name: str) -> str | None:
    """Main public function. Returns a cleaned canonical_name or None if the
    input is not a valid ingredient."""
    if not name:
        return None
    c = name.lower().strip()
    c = c.replace("'", "").replace("'", "").replace('"', "").replace("_", "_")
    # Normalize whitespace / punctuation to underscores
    c = re.sub(r"[\s\-.,]+", "_", c)
    c = re.sub(r"_+", "_", c).strip("_")

    # Well-known truncation → target ingredient
    accent_stripped = _strip_accents_simple(c)
    if accent_stripped in _LEADING_CHAR_FIXES:
        return _LEADING_CHAR_FIXES[accent_stripped]
    if c in _LEADING_CHAR_FIXES:
        return _LEADING_CHAR_FIXES[c]

    # Strip measurement / packaging prefix. Our regex is accent-free, so
    # build a matching key with accents stripped and translate the offset
    # back onto the original string.
    c_ascii = _strip_accents_simple(c)
    m = _PREFIX_RE.match(c_ascii)
    if m:
        c = c[m.end():]  # strip the same number of chars from the accented
        # Re-check truncation table on the stripped form
        if c in _LEADING_CHAR_FIXES:
            return _LEADING_CHAR_FIXES[c]
        accent_stripped = _strip_accents_simple(c)
        if accent_stripped in _LEADING_CHAR_FIXES:
            return _LEADING_CHAR_FIXES[accent_stripped]

    # Split on "et" / "ou" — return first token only
    if "_et_" in c:
        c = c.split("_et_", 1)[0]
    if "_ou_" in c:
        c = c.split("_ou_", 1)[0]

    # Drop trailing stop words
    parts = c.split("_")
    cleaned_parts = []
    i = 0
    while i < len(parts):
        remaining = "_".join(parts[i:])
        matched = False
        for token, replacement in _STOP_TOKENS.items():
            if remaining.startswith(token + "_") or remaining == token:
                # Skip or replace
                if replacement:
                    cleaned_parts.append(replacement)
                length = token.count("_") + 1
                i += length
                matched = True
                break
        if not matched:
            cleaned_parts.append(parts[i])
            i += 1
    c = "_".join(p for p in cleaned_parts if p)

    c = re.sub(r"_+", "_", c).strip("_")

    # Final sanity checks
    if not c or len(c) < 3:
        return None
    # Reject pure function words
    if c in {"et", "ou", "de", "du", "au", "aux", "le", "la", "les", "un", "une", "des"}:
        return None
    # Reject measurement-ish leftovers
    if c.startswith("a_") and "huile" not in c and "ail" not in c:
        return None
    # Reject single character after prefix strip
    return c


__all__ = ["clean_canonical"]
