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
