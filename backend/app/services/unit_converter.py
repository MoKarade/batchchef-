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
    "ml": 1.0, "millilitre": 1.0,
    "cl": 10.0, "centilitre": 10.0,
    "dl": 100.0, "decilitre": 100.0,
    "l": 1000.0, "litre": 1000.0,
    "tasse": 250.0, "cup": 250.0,
    "cuill_soupe": 15.0, "c_soupe": 15.0, "cs": 15.0,
    "cuill_cafe": 5.0, "c_cafe": 5.0, "cc": 5.0,
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
    "clementine": 80, "mandarine": 80, "peche": 150, "abricot": 40,
    "abricot_sec": 8, "prune": 60, "kiwi": 80, "fraise": 15, "framboise": 3,
    "mangue": 300, "avocat": 200, "tomate": 120, "tomate_cerise": 10,
    "concombre": 250, "courgette": 200, "aubergine": 300,
    # Légumes
    "carotte": 60, "oignon": 110, "echalote": 20, "poireau": 150,
    "pomme_de_terre": 150, "patate_douce": 200, "poivron": 160,
    # Oeufs & dérivés
    "oeuf": 60, "oeufs": 60, "jaune_oeuf": 18, "blanc_oeuf": 35,
    # Herbes & épices (par unité)
    "gousse_ail": 5, "ail": 5, "brin_thym": 1, "feuille_laurier": 0.5,
    "brin_romarin": 1, "bouquet_persil": 25,
}


def convert_count_to_mass(canonical_name: str, qty: float) -> float | None:
    """Convert a count-based quantity (e.g. '12 abricots') to grams using a
    lookup table of average per-piece weights. Returns None if the ingredient
    has no known weight — the caller should leave the unit as 'unite' in that
    case."""
    key = (canonical_name or "").strip().lower()
    if key in WEIGHT_PER_UNIT_G:
        return qty * WEIGHT_PER_UNIT_G[key]
    # try parent form (strip common prefixes like "petit_", "gros_", "demi_")
    for prefix in ("petit_", "gros_", "demi_", "moitie_", "morceau_"):
        if key.startswith(prefix):
            return convert_count_to_mass(key[len(prefix):], qty)
    return None
