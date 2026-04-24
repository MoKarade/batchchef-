import json
import re
from app.utils.time import utcnow
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, or_, func, update, delete
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, ConfigDict
from app.database import get_db
from app.models.ingredient import IngredientMaster
from app.models.recipe import RecipeIngredient
from app.models.store import StoreProduct
from app.models.inventory import InventoryItem, InventoryMovement
from app.models.batch import ShoppingListItem
from app.models.receipt import ReceiptItem
from app.models.job import ImportJob
from app.schemas.job import JobOut

router = APIRouter(prefix="/api/ingredients", tags=["ingredients"])


def _price_per_kg_m(price: float | None, qty: float | None, unit: str | None) -> float | None:
    if not (price and qty and unit):
        return None
    u = (unit or "").strip().lower()
    if u in ("g", "gramme", "grammes"):
        return round(price / (qty / 1000.0), 2)
    if u in ("kg", "kilo", "kilogramme"):
        return round(price / qty, 2)
    if u in ("ml", "millilitre"):
        return round(price / (qty / 1000.0), 2)
    if u in ("l", "litre"):
        return round(price / qty, 2)
    return None


def _unit_price_m(price: float | None, qty: float | None, unit: str | None) -> tuple[float | None, str | None]:
    """Return (price, label) adapted to the store format unit:
      mass   → price/kg        (label='kg')
      volume → price/L         (label='L')
      count  → price/unit      (label='unite')
    """
    if not (price and qty and unit):
        return None, None
    u = (unit or "").strip().lower()
    if u in ("g", "gramme", "grammes"):
        return round(price / (qty / 1000.0), 2), "kg"
    if u in ("kg", "kilo", "kilogramme"):
        return round(price / qty, 2), "kg"
    if u in ("ml", "millilitre"):
        return round(price / (qty / 1000.0), 2), "L"
    if u in ("l", "litre"):
        return round(price / qty, 2), "L"
    # Count-based: a 6-pack of eggs at 4.11$ → 0.69$/unit
    return round(price / qty, 2), "unite"


class IngredientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    canonical_name: str
    display_name_fr: str
    category: str | None = None
    subcategory: str | None = None
    is_produce: bool = False
    default_unit: str | None = None
    estimated_price_per_kg: float | None = None
    parent_id: int | None = None
    specific_unit: str | None = None
    specific_price_per_unit: float | None = None
    calories_per_100: float | None = None
    proteins_per_100: float | None = None
    carbs_per_100: float | None = None
    lipids_per_100: float | None = None
    price_mapping_status: str = "pending"
    usage_count: int = 0
    store_product_count: int = 0
    children_count: int = 0
    # Display helpers populated from the best StoreProduct
    primary_image_url: str | None = None
    primary_store_code: str | None = None
    computed_price_per_kg: float | None = None
    # Unit-adaptive price: e.g. 25.0 $/kg, 3.99 $/L, 0.75 $/unite
    computed_unit_price: float | None = None
    computed_unit_label: str | None = None  # "kg" | "L" | "unite"


class IngredientUpdate(BaseModel):
    display_name_fr: str | None = None
    category: str | None = None
    subcategory: str | None = None
    default_unit: str | None = None
    estimated_price_per_kg: float | None = None
    parent_id: int | None = None
    specific_unit: str | None = None
    specific_price_per_unit: float | None = None
    calories_per_100: float | None = None
    proteins_per_100: float | None = None
    carbs_per_100: float | None = None
    lipids_per_100: float | None = None


_UNSET = object()


def _apply_ingredient_filters(q, search, category, price_mapping_status, parent_id=_UNSET):
    if search:
        pattern = f"%{search.lower()}%"
        q = q.where(or_(
            IngredientMaster.canonical_name.ilike(pattern),
            IngredientMaster.display_name_fr.ilike(pattern),
        ))
    if category:
        q = q.where(IngredientMaster.category == category)
    if price_mapping_status:
        q = q.where(IngredientMaster.price_mapping_status == price_mapping_status)
    if parent_id is not _UNSET:
        if parent_id is None:
            q = q.where(IngredientMaster.parent_id.is_(None))
        else:
            q = q.where(IngredientMaster.parent_id == parent_id)
    return q


def _parse_parent_id(parent_id: str | None):
    if parent_id is None:
        return _UNSET
    if parent_id.lower() in ("null", "none", "root"):
        return None
    try:
        return int(parent_id)
    except ValueError:
        return _UNSET


@router.get("/count", response_model=int)
async def count_ingredients(
    search: str | None = Query(None),
    category: str | None = Query(None),
    price_mapping_status: str | None = Query(None),
    parent_id: str | None = Query(None, description="int, 'null' for top-level, omit for all"),
    db: AsyncSession = Depends(get_db),
):
    q = _apply_ingredient_filters(
        select(func.count(IngredientMaster.id)),
        search, category, price_mapping_status, _parse_parent_id(parent_id),
    )
    total = (await db.execute(q)).scalar() or 0
    return int(total)


@router.get("", response_model=list[IngredientOut])
async def list_ingredients(
    search: str | None = Query(None),
    category: str | None = Query(None),
    price_mapping_status: str | None = Query(None, description="pending|mapped|failed"),
    parent_id: str | None = Query(None, description="int, 'null' for top-level, omit for all"),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    q = _apply_ingredient_filters(
        select(IngredientMaster),
        search, category, price_mapping_status, _parse_parent_id(parent_id),
    ).order_by(IngredientMaster.canonical_name.asc()).limit(limit).offset(offset)

    ingredients = list((await db.execute(q)).scalars().all())
    if not ingredients:
        return []

    ids = [i.id for i in ingredients]
    usage_q = (
        select(RecipeIngredient.ingredient_master_id, func.count(RecipeIngredient.id))
        .where(RecipeIngredient.ingredient_master_id.in_(ids))
        .group_by(RecipeIngredient.ingredient_master_id)
    )
    usage = dict((await db.execute(usage_q)).all())

    prod_q = (
        select(StoreProduct.ingredient_master_id, func.count(StoreProduct.id))
        .where(StoreProduct.ingredient_master_id.in_(ids))
        .group_by(StoreProduct.ingredient_master_id)
    )
    prods = dict((await db.execute(prod_q)).all())

    # Best StoreProduct per ingredient (lowest price, validated first) — used to
    # expose primary_image_url + computed_price_per_kg on each card.
    from app.models.store import Store as _Store
    best_q = (
        select(
            StoreProduct.ingredient_master_id,
            StoreProduct.image_url,
            StoreProduct.price,
            StoreProduct.format_qty,
            StoreProduct.format_unit,
            _Store.code,
        )
        .join(_Store, _Store.id == StoreProduct.store_id)
        .where(
            StoreProduct.ingredient_master_id.in_(ids),
            StoreProduct.price.isnot(None),
        )
        .order_by(
            StoreProduct.ingredient_master_id,
            StoreProduct.is_validated.desc(),
            StoreProduct.price.asc(),
        )
    )
    best_by_ing: dict[int, tuple[str | None, float | None, float | None, str | None, str]] = {}
    for ing_id, img_url, price, fqty, funit, code in (await db.execute(best_q)).all():
        best_by_ing.setdefault(ing_id, (img_url, price, fqty, funit, code))

    # Use the module-level helpers (_price_per_kg_m, _unit_price_m)
    _price_per_kg = _price_per_kg_m
    _unit_price = _unit_price_m

    children_q = (
        select(IngredientMaster.parent_id, func.count(IngredientMaster.id))
        .where(IngredientMaster.parent_id.in_(ids))
        .group_by(IngredientMaster.parent_id)
    )
    children_counts = dict((await db.execute(children_q)).all())

    out: list[IngredientOut] = []
    for ing in ingredients:
        row = IngredientOut.model_validate(ing)
        row.usage_count = int(usage.get(ing.id, 0))
        row.store_product_count = int(prods.get(ing.id, 0))
        row.children_count = int(children_counts.get(ing.id, 0))
        best = best_by_ing.get(ing.id)
        if best:
            img_url, price, fqty, funit, code = best
            row.primary_image_url = img_url
            row.primary_store_code = code
            row.computed_price_per_kg = _price_per_kg(price, fqty, funit)
            up, ul = _unit_price(price, fqty, funit)
            row.computed_unit_price = up
            row.computed_unit_label = ul
        out.append(row)
    return out


@router.get("/categories", response_model=list[str])
async def list_categories(db: AsyncSession = Depends(get_db)):
    q = (
        select(IngredientMaster.category)
        .where(IngredientMaster.category.isnot(None))
        .distinct()
        .order_by(IngredientMaster.category.asc())
    )
    return [c for (c,) in (await db.execute(q)).all() if c]


@router.patch("/{ingredient_id}", response_model=IngredientOut)
async def update_ingredient(
    ingredient_id: int,
    body: IngredientUpdate,
    db: AsyncSession = Depends(get_db),
):
    ing = await db.get(IngredientMaster, ingredient_id)
    if not ing:
        raise HTTPException(status_code=404, detail="Ingredient not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(ing, k, v)
    await db.commit()
    await db.refresh(ing)
    out = IngredientOut.model_validate(ing)
    return out


class StoreProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    store_id: int
    store_code: str | None = None
    store_name: str | None = None
    product_name: str | None = None
    product_url: str | None = None
    image_url: str | None = None
    price: float | None = None
    format_qty: float | None = None
    format_unit: str | None = None
    is_validated: bool = False
    confidence_score: float | None = None
    last_checked_at: str | None = None


class RecipeBriefForIng(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    image_url: str | None = None
    meal_type: str | None = None
    servings: int | None = None
    quantity_per_portion: float | None = None
    unit: str | None = None


class PricePoint(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    store_code: str
    price: float
    recorded_at: str


class IngredientDetails(IngredientOut):
    store_products: list[StoreProductOut] = []
    recipes: list[RecipeBriefForIng] = []
    price_history: list[PricePoint] = []


@router.get("/{ingredient_id}/details", response_model=IngredientDetails)
async def ingredient_details(
    ingredient_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Full detail view: ingredient + per-store prices (with URLs) + recipes using it."""
    from app.models.store import Store
    from app.models.recipe import Recipe

    ing = await db.get(IngredientMaster, ingredient_id)
    if not ing:
        raise HTTPException(status_code=404, detail="Ingredient not found")

    # Store products + store info
    sp_rows = (await db.execute(
        select(StoreProduct, Store)
        .join(Store, Store.id == StoreProduct.store_id)
        .where(StoreProduct.ingredient_master_id == ingredient_id)
    )).all()
    products: list[StoreProductOut] = []
    for sp, store in sp_rows:
        products.append(StoreProductOut(
            id=sp.id,
            store_id=sp.store_id,
            store_code=store.code,
            store_name=store.name,
            product_name=sp.product_name,
            product_url=sp.product_url,
            image_url=sp.image_url,
            price=sp.price,
            format_qty=sp.format_qty,
            format_unit=sp.format_unit,
            is_validated=bool(sp.is_validated),
            confidence_score=sp.confidence_score,
            last_checked_at=sp.last_checked_at.isoformat() if sp.last_checked_at else None,
        ))

    # Recipes using this ingredient (via RecipeIngredient)
    rec_rows = (await db.execute(
        select(Recipe, RecipeIngredient)
        .join(RecipeIngredient, RecipeIngredient.recipe_id == Recipe.id)
        .where(RecipeIngredient.ingredient_master_id == ingredient_id)
        .order_by(Recipe.title)
        .limit(50)
    )).all()

    from app.models.store import PriceHistory
    ph_rows = (await db.execute(
        select(PriceHistory.price, PriceHistory.recorded_at, Store.code)
        .join(StoreProduct, StoreProduct.id == PriceHistory.store_product_id)
        .join(Store, Store.id == StoreProduct.store_id)
        .where(StoreProduct.ingredient_master_id == ingredient_id)
        .order_by(PriceHistory.recorded_at.desc())
        .limit(30)
    )).all()
    price_history = [
        PricePoint(price=p, recorded_at=ts.isoformat() if ts else "", store_code=code)
        for p, ts, code in ph_rows
    ]
    # Deduplicate by recipe id — a recipe may legitimately list the same
    # ingredient on two lines (cream in sauce + cream in topping), which
    # would otherwise collide with React's key= on the frontend.
    seen_recipes: set[int] = set()
    recipes: list[RecipeBriefForIng] = []
    for r, ri in rec_rows:
        if r.id in seen_recipes:
            continue
        seen_recipes.add(r.id)
        recipes.append(RecipeBriefForIng(
            id=r.id,
            title=r.title,
            image_url=r.image_url,
            meal_type=r.meal_type,
            servings=r.servings,
            quantity_per_portion=ri.quantity_per_portion,
            unit=ri.unit,
        ))

    # Counts (same as in list endpoint)
    usage_count = (await db.execute(
        select(func.count(RecipeIngredient.id)).where(
            RecipeIngredient.ingredient_master_id == ingredient_id
        )
    )).scalar() or 0
    children_count = (await db.execute(
        select(func.count(IngredientMaster.id)).where(
            IngredientMaster.parent_id == ingredient_id
        )
    )).scalar() or 0

    # Compute unit-adaptive price from the cheapest priced product
    computed_unit_price: float | None = None
    computed_unit_label: str | None = None
    computed_price_per_kg: float | None = None
    primary_image_url: str | None = None
    primary_store_code: str | None = None
    best_sp: StoreProductOut | None = None
    for p in products:
        if p.price is None:
            continue
        if best_sp is None or (p.price < (best_sp.price or float("inf"))):
            best_sp = p
    if best_sp:
        primary_image_url = best_sp.image_url
        primary_store_code = best_sp.store_code
        computed_price_per_kg = _price_per_kg_m(best_sp.price, best_sp.format_qty, best_sp.format_unit)
        up, ul = _unit_price_m(best_sp.price, best_sp.format_qty, best_sp.format_unit)
        computed_unit_price = up
        computed_unit_label = ul

    return IngredientDetails(
        id=ing.id,
        canonical_name=ing.canonical_name,
        display_name_fr=ing.display_name_fr,
        category=ing.category,
        subcategory=ing.subcategory,
        is_produce=bool(ing.is_produce),
        default_unit=ing.default_unit,
        estimated_price_per_kg=ing.estimated_price_per_kg,
        parent_id=ing.parent_id,
        specific_unit=ing.specific_unit,
        specific_price_per_unit=ing.specific_price_per_unit,
        calories_per_100=ing.calories_per_100,
        proteins_per_100=ing.proteins_per_100,
        carbs_per_100=ing.carbs_per_100,
        lipids_per_100=ing.lipids_per_100,
        price_mapping_status=ing.price_mapping_status or "pending",
        usage_count=usage_count,
        store_product_count=len(products),
        children_count=children_count,
        primary_image_url=primary_image_url,
        primary_store_code=primary_store_code,
        computed_price_per_kg=computed_price_per_kg,
        computed_unit_price=computed_unit_price,
        computed_unit_label=computed_unit_label,
        store_products=products,
        recipes=recipes,
        price_history=price_history,
    )


# NOTE: the old /classify and /sanitize-names endpoints were removed in V3.
# Name cleanup is now handled by the offline script
# `scripts/build_canonical_hierarchy.py` which builds the parent/variant
# hierarchy in one pass.


_BAD_CANONICAL = re.compile(r"^[\s\-_\d,./]+")

# Gemini parse artefacts: unit-phrase fragments that ended up being
# treated as canonical names when the LLM returned malformed output
# during classification. Examples we saw in prod with counts (all 2026-04-24):
#   743× "a_cafe_de_X" / "a_soupe_de_X"  (cuillère à café / soupe leaked)
#   139× 1-2-letter_X               (Gemini token truncation)
#    35× "s_(125_ml)_de_X"              (verre measurement leaked)
#    32× "es_(X)_Y"                     (plural stub leaked)
#    12× "verres_dX"                    (verre d' leaked)
#     6× "pincées_dX"
#     5× "tasses_dX"
# Prefix + suffix stripping iterates (see _clean_canonical) so stacked
# artefacts like "a_cafe_rases_de_poivre" eventually resolve to "poivre".
_FRAGMENT_PREFIXES = [
    # Cuillères à café / soupe (most common)
    "a_cafe_de_", "a_cafe_d_", "a_cafe_rases_de_", "a_cafe_",
    "a_soupe_de_", "a_soupe_d_", "a_soupe_rases_de_", "a_soupe_",
    "cuillere_a_cafe_de_", "cuillere_a_soupe_de_",
    "cuilleres_a_cafe_de_", "cuilleres_a_soupe_de_",
    "cuillere_de_", "cuilleres_de_", "cuill_de_",
    "cuillères_de_", "cuillère_de_",
    # Pincées
    "pincees_de_", "pincees_d_", "pincees_", "pincée_", "pincees_",
    "pincée_de_", "pincées_de_", "pincée_d_", "pincées_d_",
    "pincees_dail_", "pincees_dorigan_",  # explicit seen examples
    # Tasses / verres / bols
    "tasses_de_", "tasse_de_", "tasses_d_", "tasse_d_", "tasses_a_",
    "verres_de_", "verre_de_", "verres_d_", "verre_d_", "verres_deau",
    "bols_de_", "bol_de_", "bols_d_", "bol_d_",
    "tranches_de_", "tranche_de_",
    # Gramme/ml/cl/dl/l abbreviations
    "grammes_de_", "gramme_de_", "g_de_",
    "litres_de_", "litre_de_", "l_de_",
    "ml_de_", "cl_de_", "dl_de_", "kg_de_",
    # Plurals / prepositions leaked from French grammar
    "s_de_", "s_d_", "s_a_", "s_à_", "s_(125_ml)_de_", "s_(250ml)_de_",
    "s_(250_ml)_de_", "s_(25cl)_de_", "s_(500ml)_de_",
    "es_de_", "e_de_", "es_(",
    "de_", "du_", "des_", "d_",
    # Abbrev variants seen
    "cas_de_", "càs_de_", "cac_de_", "càc_de_", "cs_de_", "cc_de_",
]
_FRAGMENT_PATTERN = re.compile(
    r"^(" + "|".join(re.escape(p) for p in _FRAGMENT_PREFIXES) + ")",
    re.IGNORECASE,
)

# ID-accretion artefact: Gemini sometimes appended the raw ingredient_id
# to the canonical_name (e.g. "a_cafe_dail__1013"). Strip that trailing
# "__NNN" or "_NNN" before doing the prefix/suffix pass.
_ID_SUFFIX = re.compile(r"__?\d+$")

# Parenthesized measurement clauses that the LLM kept in-line:
#   "s_(125_ml)_de_crème" or "es_(magnum)"
_PAREN_MEASURE = re.compile(r"\([^)]*\)")


def _normalize_accents(s: str) -> str:
    """Strip accents so regex matching is predictable — ``à`` / ``é`` /
    ``è`` / ``ç`` all become plain ASCII. Keeps the rest of the string
    intact (numbers, underscores)."""
    import unicodedata
    nfd = unicodedata.normalize("NFD", s)
    return "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")


# One mega-regex built from alternations so plural `s` can show up at
# any boundary — "cuillere_a_cafe" OR "cuilleres_a_cafe" OR "cuillere_a_cafes"
# all match without enumerating every permutation.
#
# Groups (all optional except the stem):
#   1. plural leak "s_" at the very start
#   2. the unit stem itself, with optional plural `s`
#   3. optional "rases/bombees/combles" qualifier
#   4. preposition (`_de_`, `_du_`, `_des_`, `_a_`, or `_d` glued to a word)
_FRAG_RE = re.compile(
    r"^(?:s_)?"
    r"(?:"
        r"cuilleres?_a_cafes?"      # "cuillère à café" + any plural
        r"|cuilleres?_a_soupes?"
        r"|a_cafes?"
        r"|a_soupes?"
        r"|cuilleres?"
        r"|cuill"
        r"|pincees?"
        r"|tasses?"
        r"|bols?"
        r"|verres?"
        r"|grammes?"
        r"|litres?"
        r"|tranches?"
        r"|morceaux?"
        r"|rondelles?"
    r")"
    r"(?:_(?:rases?|bombees?|combles?))?"
    r"(?:_(?:de|du|des|a)_|_d(?=[a-z]))?",
    re.IGNORECASE,
)

# Standalone preposition leak at the start of a name. Added `s` and `es`
# (plural stubs), plus `d(?=[a-z])` for glued "d'eau" → "deau" case.
# The lookahead version is tried separately from the "_|$" version so we
# don't accidentally eat `de` from `de_creme` (which is handled by "_").
_PREPOSITION_PREFIX = re.compile(
    r"^(?:(de|du|des|d|a|au|aux|s|es)(_|$)|d(?=[a-z]{2,}))",
    re.IGNORECASE,
)


def _clean_canonical(raw: str) -> str:
    """Iteratively strip garbage off a Gemini-generated canonical_name.

    Layers applied (order matters):
      1. NFD normalization — accents stripped so ``cuillère`` ≡ ``cuillere``
      2. Trailing ``__NNN`` / ``_NNN`` ID accretion
      3. Parenthesized measurement clauses ``(125_ml)``
      4. Known unit-phrase prefixes via ``_FRAG_RE`` (handles glued ``d'``)
      5. Leading prepositions (``de_X``, ``du_X``, ``a_X`` alone)
      6. Leading digits / punctuation noise
      7. Whitespace + double-underscore normalization

    Loop 6×: stacked artefacts like
    ``a_soupe_rases_de_poivre_noir_moulu__15640`` resolve to ``poivre_noir_moulu``.
    """
    if not raw:
        return ""
    # 1. Accent normalization
    c = _normalize_accents(raw).lower().strip()
    # 2. Strip trailing ID suffix (one or two leading underscores + digits)
    c = _ID_SUFFIX.sub("", c)
    # 3. Strip parenthesized clauses: "(125 ml)" etc.
    c = _PAREN_MEASURE.sub("", c)
    c = re.sub(r"\s+", "_", c)          # normalize whitespace early
    c = re.sub(r"_+", "_", c).strip("_")

    # 4+5+6. Iterative prefix + noise removal
    for _ in range(6):
        before = c
        c = _BAD_CANONICAL.sub("", c)
        # try the heavy unit-phrase regex first
        m = _FRAG_RE.match(c)
        if m and m.end() > 0:
            # don't strip if it would leave nothing (e.g. "pincee" alone)
            remainder = c[m.end():].lstrip("_")
            if remainder and len(remainder) >= 2:
                c = remainder
        # then try a bare preposition
        m2 = _PREPOSITION_PREFIX.match(c)
        if m2:
            remainder = c[m2.end():].lstrip("_")
            if remainder and len(remainder) >= 2:
                c = remainder
        if c == before:
            break

    c = re.sub(r"_+", "_", c).strip("_ ")
    # Final sanity: names of 1-2 chars are almost always artefacts
    # ("au", "es", "s"). Returning empty signals "unrepairable" to the
    # caller (repair-prefixes will then skip or delete-if-unused).
    if len(c) <= 2:
        return ""
    return c


class RepairResult(BaseModel):
    scanned: int
    renamed: int
    merged: int
    skipped: int


@router.post("/repair-prefixes", response_model=RepairResult)
async def repair_prefixes(db: AsyncSession = Depends(get_db)):
    """Strip bogus leading digits/dashes from canonical_name + display_name.

    If the cleaned canonical already exists as another row, merge FKs into it
    and drop the corrupted row. Otherwise rename in place.
    """
    q = select(IngredientMaster)
    rows = list((await db.execute(q)).scalars().all())

    scanned = 0
    renamed = 0
    merged = 0
    skipped = 0

    for ing in rows:
        name = ing.canonical_name or ""
        # A row is "bad" if the new mega-cleaner actually changes it. This
        # is the most robust detection — any legacy pattern, any leading
        # unit phrase, any trailing ID accretion, any accent weirdness all
        # produce a different output. Compare normalized-to-normalized to
        # avoid false "changed" on ``œ`` vs ``oe``.
        normalized = _normalize_accents(name).lower().strip()
        cleaned_preview = _clean_canonical(name)
        if cleaned_preview == normalized or not cleaned_preview:
            continue
        scanned += 1
        clean = cleaned_preview
        if not clean or len(clean) < 2:
            skipped += 1
            continue

        # Try to find an existing clean twin
        twin_q = select(IngredientMaster).where(
            IngredientMaster.canonical_name == clean,
            IngredientMaster.id != ing.id,
        )
        twin = (await db.execute(twin_q)).scalar_one_or_none()

        new_display = clean.replace("_", " ").capitalize()

        if twin:
            # Reassign FKs to twin and delete the bad row
            for model, col in (
                (RecipeIngredient, RecipeIngredient.ingredient_master_id),
                (StoreProduct, StoreProduct.ingredient_master_id),
                (InventoryItem, InventoryItem.ingredient_master_id),
                (InventoryMovement, InventoryMovement.ingredient_master_id),
                (ShoppingListItem, ShoppingListItem.ingredient_master_id),
                (ReceiptItem, ReceiptItem.ingredient_master_id),
            ):
                await db.execute(
                    update(model).where(col == ing.id).values(ingredient_master_id=twin.id)
                )
            # Clear any self-parent references pointing at the bad row
            await db.execute(
                update(IngredientMaster)
                .where(IngredientMaster.parent_id == ing.id)
                .values(parent_id=twin.id)
            )
            await db.execute(delete(IngredientMaster).where(IngredientMaster.id == ing.id))
            merged += 1
        else:
            ing.canonical_name = clean
            # Only overwrite display if it looks corrupted too
            if _BAD_CANONICAL.match(ing.display_name_fr or ""):
                ing.display_name_fr = new_display
            renamed += 1

    await db.commit()
    return RepairResult(scanned=scanned, renamed=renamed, merged=merged, skipped=skipped)


class PriceCoverageItem(BaseModel):
    id: int
    canonical_name: str
    display_name_fr: str
    attempts: int


class PriceCoverageOut(BaseModel):
    total: int
    priced: int
    coverage_pct: float
    by_store: dict[str, int]
    unpriced: list[PriceCoverageItem]


class PricingEtaOut(BaseModel):
    pending_count: int
    avg_seconds_per_ingredient: float
    eta_seconds: int
    eta_human: str


@router.get("/pricing-eta", response_model=PricingEtaOut)
async def pricing_eta(db: AsyncSession = Depends(get_db)):
    """Estimates how long before every ingredient has a price.

    Uses the average runtime/(progress_total) of the last 10 completed
    `price_mapping` jobs. Falls back to 30s per ingredient if no history.
    """
    from datetime import datetime

    recent = (await db.execute(
        select(ImportJob)
        .where(
            ImportJob.job_type == "price_mapping",
            ImportJob.status == "completed",
            ImportJob.finished_at.isnot(None),
            ImportJob.progress_total > 0,
        )
        .order_by(ImportJob.finished_at.desc())
        .limit(10)
    )).scalars().all()

    if recent:
        total_secs = 0.0
        total_items = 0
        for j in recent:
            if j.started_at and j.finished_at and j.progress_total:
                secs = (j.finished_at - j.started_at).total_seconds()
                total_secs += secs
                total_items += j.progress_total
        avg = total_secs / max(total_items, 1) if total_items else 30.0
    else:
        avg = 30.0

    pending = (await db.execute(
        select(func.count()).select_from(IngredientMaster).where(
            or_(
                IngredientMaster.price_mapping_status.is_(None),
                IngredientMaster.price_mapping_status != "mapped",
            )
        )
    )).scalar_one()

    eta_sec = int(pending * avg)
    h, m = divmod(eta_sec // 60, 60)
    d, h = divmod(h, 24)
    if d > 0:
        human = f"{d}j {h}h"
    elif h > 0:
        human = f"{h}h {m}min"
    else:
        human = f"{m}min"
    return PricingEtaOut(
        pending_count=pending,
        avg_seconds_per_ingredient=round(avg, 1),
        eta_seconds=eta_sec,
        eta_human=human,
    )


@router.get("/price-coverage", response_model=PriceCoverageOut)
async def get_price_coverage(db: AsyncSession = Depends(get_db)):
    """Returns ingredient price coverage stats and list of unpriced ingredients."""
    from sqlalchemy import distinct

    total = (await db.execute(select(func.count()).select_from(IngredientMaster))).scalar_one()

    # Count ingredients with at least one validated StoreProduct with a price
    priced_subq = (
        select(distinct(StoreProduct.ingredient_master_id))
        .where(StoreProduct.is_validated.is_(True), StoreProduct.price.isnot(None))
        .scalar_subquery()
    )
    priced = (
        await db.execute(
            select(func.count()).select_from(IngredientMaster)
            .where(IngredientMaster.id.in_(priced_subq))
        )
    ).scalar_one()

    # Coverage per store
    stores_q = select(
        StoreProduct.store_id,
        func.count(distinct(StoreProduct.ingredient_master_id))
    ).where(
        StoreProduct.is_validated.is_(True),
        StoreProduct.price.isnot(None),
    ).group_by(StoreProduct.store_id)
    store_rows = (await db.execute(stores_q)).all()

    from app.models.store import Store
    store_ids = [r[0] for r in store_rows]
    stores_by_id: dict[int, Store] = {}
    if store_ids:
        for s in (await db.execute(select(Store).where(Store.id.in_(store_ids)))).scalars().all():
            stores_by_id[s.id] = s
    by_store = {
        stores_by_id[sid].code if sid in stores_by_id else str(sid): count
        for sid, count in store_rows
    }

    # Unpriced ingredients
    unpriced_q = (
        select(IngredientMaster)
        .where(IngredientMaster.id.not_in(priced_subq))
        .order_by(IngredientMaster.price_map_attempts.desc())
        .limit(100)
    )
    unpriced_ings = list((await db.execute(unpriced_q)).scalars().all())

    return PriceCoverageOut(
        total=total,
        priced=priced,
        coverage_pct=round(priced / total * 100, 1) if total else 0.0,
        by_store=by_store,
        unpriced=[
            PriceCoverageItem(
                id=i.id,
                canonical_name=i.canonical_name,
                display_name_fr=i.display_name_fr,
                attempts=i.price_map_attempts or 0,
            )
            for i in unpriced_ings
        ],
    )


@router.post("/retry-missing-prices", status_code=202)
async def retry_missing_prices(db: AsyncSession = Depends(get_db)):
    """Re-dispatch map-prices for every ingredient that's still pending."""
    from app.workers.map_prices import run_price_mapping
    pending_q = select(IngredientMaster.id).where(IngredientMaster.price_mapping_status != "mapped")
    ids = [r[0] for r in (await db.execute(pending_q)).all()]
    job = ImportJob(job_type="price_mapping", status="queued", progress_total=len(ids))
    db.add(job)
    await db.commit()
    await db.refresh(job)
    try:
        task = run_price_mapping.delay(job.id, None, ids)
        job.celery_task_id = task.id
        job.status = "running"
        job.started_at = utcnow()
    except Exception as e:
        job.status = "failed"
        job.error_log = json.dumps([str(e)])
    await db.commit()
    return {"status": "queued", "job_id": job.id, "count": len(ids)}


@router.post("/{ingredient_id}/unmap", response_model=IngredientOut)
async def unmap_ingredient(ingredient_id: int, db: AsyncSession = Depends(get_db)):
    """Reset an ingredient to 'pending' so it re-enters the price-mapping queue.

    Invalidates its StoreProducts so the next mapping pass regenerates them.
    """
    ing = await db.get(IngredientMaster, ingredient_id)
    if not ing:
        raise HTTPException(status_code=404, detail="Ingredient not found")
    ing.price_mapping_status = "pending"
    ing.last_price_mapping_at = None

    sp_q = select(StoreProduct).where(StoreProduct.ingredient_master_id == ingredient_id)
    for sp in (await db.execute(sp_q)).scalars().all():
        sp.is_validated = False

    await db.commit()
    await db.refresh(ing)
    out = IngredientOut.model_validate(ing)
    return out
