"""
Unit conversion utilities.
All conversions normalize to a "base unit": g (mass), ml (volume), unite (count).
"""

MASS_TO_G: dict[str, float] = {
    "g": 1.0, "gramme": 1.0, "grammes": 1.0,
    "kg": 1000.0, "kilo": 1000.0, "kilogramme": 1000.0,
    "mg": 0.001,
    "lb": 453.592, "livre": 453.592,
    "oz": 28.3495,
}

VOLUME_TO_ML: dict[str, float] = {
    "ml": 1.0, "millilitre": 1.0, "millilitres": 1.0,
    "cl": 10.0, "centilitre": 10.0, "centilitres": 10.0,
    "dl": 100.0, "decilitre": 100.0, "decilitres": 100.0,
    "l": 1000.0, "litre": 1000.0, "litres": 1000.0,
    "tasse": 250.0, "tasses": 250.0, "cup": 250.0, "cups": 250.0,
    # Cuillère à soupe (tablespoon) ≈ 15 ml
    "cuill_soupe": 15.0, "c_soupe": 15.0, "cs": 15.0,
    "cuill_a_soupe": 15.0, "cuillere_a_soupe": 15.0, "cuilleres_a_soupe": 15.0,
    "tbsp": 15.0, "tbs": 15.0,
    # Cuillère à café (teaspoon) ≈ 5 ml
    "cuill_cafe": 5.0, "c_cafe": 5.0, "cc": 5.0,
    "cuill_a_cafe": 5.0, "cuillere_a_cafe": 5.0, "cuilleres_a_cafe": 5.0,
    "tsp": 5.0,
    # Bare "cuill" / "cuillère" — Marmiton scraper sometimes truncates
    # the qualifier. Default to soupe (the more common cooking size)
    # rather than leaving it unclassified as "unite".
    "cuill": 15.0, "cuillere": 15.0, "cuilleres": 15.0,
    "c": 15.0,
    # Pincée ≈ 0.5 g-equivalent but we're in volume here, so treat as
    # "a tiny amount" → 1 ml (close enough for herbs/spices). Without
    # this, "3 pincées de sel" becomes "3 unités de sel" ($0 est cost).
    "pincee": 1.0, "pincees": 1.0, "pince": 1.0,
    "fl_oz": 29.5735,
}

ITEM_SYNONYMS: set[str] = {
    "unite", "unité", "piece", "pièce", "pc",
    "gousse", "feuille", "brin", "bouquet", "tranche",
    "branche", "tige", "noisette",
}


def normalize_unit(unit: str) -> tuple[str, str]:
    """
    Returns (normalized_unit, base_type) where base_type in {'mass', 'volume', 'count'}.
    normalized_unit is the canonical base: 'g', 'ml', 'unite'.
    """
    u = unit.lower().strip().replace(" ", "_").replace("à", "a").replace("é", "e")
    if u in MASS_TO_G:
        return "g", "mass"
    if u in VOLUME_TO_ML:
        return "ml", "volume"
    return "unite", "count"


def to_base(qty: float, unit: str) -> float:
    """Convert qty in given unit to base unit (g / ml / unite)."""
    u = unit.lower().strip().replace(" ", "_")
    if u in MASS_TO_G:
        return qty * MASS_TO_G[u]
    if u in VOLUME_TO_ML:
        return qty * VOLUME_TO_ML[u]
    return qty  # count — keep as-is


def get_scale_factor(need_qty: float, need_unit: str, format_qty: float, format_unit: str) -> float:
    """
    Calculate how many *formats* are needed to fulfil need_qty in need_unit.
    Returns a float (can be fractional for partial-pack estimation).
    Returns 0 on incompatible units.
    """
    need_base = to_base(need_qty, need_unit)
    fmt_base = to_base(format_qty, format_unit)
    if fmt_base <= 0:
        return 0.0
    _, need_type = normalize_unit(need_unit)
    _, fmt_type = normalize_unit(format_unit)
    if need_type != fmt_type:
        return 0.0  # incompatible (g vs ml)
    return need_base / fmt_base


# Average weight per single item, in grams. Used as a fallback when the recipe
# expresses a quantity in "pieces" but the store sells the ingredient by mass.
# Values are rough but better than displaying absurd counts (eg. "48 apricots").
# Lowercase canonical_name → grams per single item.
WEIGHT_PER_UNIT_G: dict[str, float] = {
    # Fruits
    "pomme": 180, "poire": 180, "banane": 120, "orange": 180, "citron": 100,
    "lime": 60, "clementine": 80, "mandarine": 80, "peche": 150, "nectarine": 150,
    "abricot": 40, "abricot_sec": 8, "prune": 60, "kiwi": 80, "fraise": 15,
    "framboise": 3, "mure": 5, "myrtille": 1, "cerise": 8, "groseille": 0.5,
    "mangue": 300, "avocat": 200, "ananas": 1000, "melon": 1500, "pasteque": 3000,
    "figue": 60, "grenade": 250, "papaye": 500,
    # Légumes fruits
    "tomate": 120, "tomate_cerise": 10, "tomate_italienne": 80, "tomate_coeur_boeuf": 200,
    "concombre": 250, "courgette": 200, "aubergine": 300, "poivron": 160,
    "piment": 20, "artichaut": 300, "mais": 300,
    # Légumes racines / tubercules
    "carotte": 60, "oignon": 110, "oignon_rouge": 110, "oignon_blanc": 100,
    "echalote": 20, "poireau": 150, "pomme_de_terre": 150, "patate_douce": 200,
    "navet": 180, "betterave": 180, "radis": 15, "panais": 120, "rutabaga": 300,
    "topinambour": 60, "gingembre": 50,
    # Courges / crucifères
    "courge": 1500, "potiron": 2000, "potimarron": 1200, "butternut": 1500,
    "brocoli": 400, "chou_fleur": 600, "chou": 1000, "chou_rouge": 800,
    "chou_de_bruxelles": 15, "chou_chinois": 700, "fenouil": 300,
    # Oeufs & dérivés
    "oeuf": 60, "oeufs": 60, "jaune_oeuf": 18, "blanc_oeuf": 35,
    "oeuf_caille": 10,
    # Salades / feuilles
    "laitue": 300, "salade": 300, "roquette": 100, "epinard": 150, "mache": 100,
    "endive": 100,
    # Herbes & aromates (par unité/brin/gousse)
    "gousse_ail": 5, "ail": 5, "gousse_dail": 5, "brin_thym": 1,
    "feuille_laurier": 0.5, "laurier": 0.5, "brin_romarin": 1, "brin_ciboulette": 1,
    "bouquet_persil": 25, "bouquet_coriandre": 20, "bouquet_basilic": 20,
    "bouquet_menthe": 20, "bouquet_aneth": 20, "branche_celeri": 50,
    "tige_celeri": 50, "celeri": 50,
    # Produits transformés courants
    "pain": 500, "baguette": 250, "saucisse": 80, "saucisson": 200,
    "merguez": 60, "chipolata": 40,
    # Champignons
    "champignon_de_paris": 15, "champignon": 15, "cepe": 40, "girolle": 10,
    "shiitake": 15, "pleurote": 25,
    # Dry staples — the recipe occasionally says "5 unités de sel"
    # (which makes no sense but Gemini sometimes writes that when the
    # original line was "5 pincées" that fell through the pincée regex).
    # We give them a tiny weight so the shopping list doesn't show
    # "5 × unité" with $0.00. These numbers are "1 pinch of" equivalents.
    "sel": 2, "sel_marin": 2, "sel_fin": 2, "sel_gros": 3,
    "poivre": 1, "poivre_noir": 1, "poivre_blanc": 1,
    "sucre": 5, "sucre_glace": 5, "cassonade": 5,
    "farine": 10,  # trivial "unité" fallback; real recipes use g or cuill
}


# Suffix stripping order matters — more specific first. e.g. "pomme_de_terre_charlotte"
# should try "pomme_de_terre" before it ever considers "pomme".
_VARIANT_SUFFIXES: tuple[str, ...] = (
    # Variety names that follow the ingredient (common on Marmiton pages)
    "_charlotte", "_grenaille", "_nouvelle", "_primeur", "_rate", "_belle_de_fontenay",
    "_bintje", "_agria", "_ratte", "_amandine", "_monalisa",
    "_granny_smith", "_golden", "_fuji", "_gala", "_pink_lady", "_royal_gala",
    "_conference", "_comice", "_williams",
    "_cherry", "_grappe", "_coeur_de_boeuf", "_roma", "_italienne",
    "_rouge", "_jaune", "_vert", "_verte", "_blanc", "_blanche", "_noir", "_noire",
    "_doux", "_douce", "_pique", "_piquant", "_piquante",
    # Size qualifiers
    "_petit", "_petite", "_petits", "_petites", "_moyen", "_moyenne",
    "_gros", "_grosse", "_grand", "_grande", "_mini",
    # Processing
    "_frais", "_fraiche", "_seche", "_sechee", "_en_conserve", "_surgele", "_surgelee",
    "_cru", "_crue", "_cuit", "_cuite", "_rapee", "_hache", "_hachee",
)

_VARIANT_PREFIXES: tuple[str, ...] = (
    "petit_", "petits_", "petite_", "petites_",
    "gros_", "grosse_", "grand_", "grande_",
    "demi_", "moitie_", "morceau_", "tranche_", "rondelle_",
    "mini_",
)


def convert_count_to_mass(canonical_name: str, qty: float) -> float | None:
    """Convert a count-based quantity (e.g. '12 abricots') to grams using a
    lookup table of average per-piece weights. Returns None if no match.

    Falls back by stripping common variant suffixes (``_charlotte``,
    ``_granny_smith``, ``_rouge``…) and prefixes (``petit_``, ``demi_``…) so
    that ``pomme_de_terre_charlotte`` resolves to ``pomme_de_terre`` weight.
    """
    key = (canonical_name or "").strip().lower()
    if not key:
        return None
    if key in WEIGHT_PER_UNIT_G:
        return qty * WEIGHT_PER_UNIT_G[key]

    # Strip one variant suffix and retry (recursive — handles stacked suffixes
    # like ``pomme_golden_petite``). Longest suffixes first via the order in
    # _VARIANT_SUFFIXES.
    for suffix in _VARIANT_SUFFIXES:
        if key.endswith(suffix) and len(key) > len(suffix):
            return convert_count_to_mass(key[: -len(suffix)], qty)

    # Strip one variant prefix and retry.
    for prefix in _VARIANT_PREFIXES:
        if key.startswith(prefix):
            return convert_count_to_mass(key[len(prefix):], qty)

    return None
