"""
Marmiton recipe scraper using Playwright.
scrape_recipe(url) → dict | None
"""
import logging
import re

logger = logging.getLogger(__name__)


def _extract_marmiton_id(url: str) -> str | None:
    m = re.search(r"_(\d+)\.aspx", url)
    return m.group(1) if m else None


def _parse_ingredient_line(raw: str) -> dict:
    """Parse '200 g de farine' → {raw_text, quantity, unit, name_raw}.

    Normalizes common French measurement variants so the downstream
    unit converter has a clean input:
      - "cuillère à soupe" / "cuillères à soupe" / "c.à.s." → cuill_soupe
      - "cuillère à café"  / "c.à.c."                       → cuill_cafe
      - "pincée" / "pincées"                                → pincee
    Without this the parser was emitting bare "cuill" or literal
    "cuillère" which the converter treats as "count" → broken shopping
    list quantities (user saw "3.5 cuill de crème fraîche" priced $0.00).
    """
    raw = raw.strip()
    raw_stripped = re.sub(r"^[\-•·⁃\*]+\s*", "", raw)

    # Normalize full phrases BEFORE the regex so "2 cuillères à soupe
    # de farine" gets rewritten to "2 cuill_soupe de farine".
    norm = raw_stripped.lower()
    norm = re.sub(r"cuill[eè]res?\s*[àa]\s*soupe", "cuill_soupe", norm, flags=re.IGNORECASE)
    norm = re.sub(r"cuill[eè]res?\s*[àa]\s*caf[ée]", "cuill_cafe", norm, flags=re.IGNORECASE)
    norm = re.sub(r"c\.?\s*[àa]?\.?\s*s\.?", "cuill_soupe", norm, flags=re.IGNORECASE)
    norm = re.sub(r"c\.?\s*[àa]?\.?\s*c\.?", "cuill_cafe", norm, flags=re.IGNORECASE)
    norm = re.sub(r"pinc[eé]es?", "pincee", norm, flags=re.IGNORECASE)

    m = re.match(
        r"^([\d.,/]+)?\s*"
        r"(kg|g|gramme|grammes|l|litre|litres|ml|cl|dl|tasse|tasses|cup|cups|"
        r"cuill_soupe|cuill_cafe|cuillere|cuilleres|cuill|cs|cc|tbsp|tsp|"
        r"lb|oz|pincee)\b\s*"
        r"(?:d[eu]s?\s*|d'|d’)?"
        r"(.+)$",
        norm,
        re.IGNORECASE,
    )
    if not m:
        m = re.match(
            r"^([\d.,/]+)?\s*"
            r"(?:d[eu]s?\s*|d'|d’)?"
            r"(.+)$",
            raw_stripped,
            re.IGNORECASE,
        )
        if m:
            qty_str, name_raw = m.group(1), m.group(2)
            try:
                qty = float(qty_str.replace(",", ".")) if qty_str else 1.0
            except ValueError:
                qty = 1.0
            return {"raw_text": raw, "quantity": qty, "unit": "unite", "name_raw": name_raw.strip()}
        return {"raw_text": raw, "quantity": 1.0, "unit": "unite", "name_raw": raw_stripped}

    qty_str, unit, name_raw = m.group(1), m.group(2), m.group(3)
    try:
        qty = float(qty_str.replace(",", ".")) if qty_str else 1.0
    except ValueError:
        qty = 1.0
    return {"raw_text": raw, "quantity": qty, "unit": unit.lower() if unit else "unite", "name_raw": name_raw.strip()}


async def scrape_recipe(url: str, page) -> dict | None:
    """
    Scrape a single Marmiton recipe URL.
    Returns a dict (with 'title') or None on error.
    """
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=25000)

        json_ld = await page.evaluate("""() => {
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const s of scripts) {
                try {
                    const d = JSON.parse(s.textContent);
                    const items = Array.isArray(d) ? d : [d];
                    for (const item of items) {
                        if (item['@type'] === 'Recipe') return item;
                    }
                } catch(e) {}
            }
            return null;
        }""")

        if json_ld:
            result = _parse_json_ld(url, json_ld)
            if result:
                return result

        return await _parse_css(url, page)

    except Exception as e:
        logger.warning(f"scrape_recipe error for {url}: {e}")
        return None


def _parse_json_ld(url: str, d: dict) -> dict | None:
    def parse_duration(iso: str | None) -> int | None:
        if not iso:
            return None
        m = re.search(r"PT(?:(\d+)H)?(?:(\d+)M)?", iso)
        if m:
            return int(m.group(1) or 0) * 60 + int(m.group(2) or 0)
        return None

    title = d.get("name", "").strip()
    if not title:
        return None

    image = d.get("image")
    if isinstance(image, list):
        image = image[0]
    if isinstance(image, dict):
        image = image.get("url", "")

    raw_servings = d.get("recipeYield", "4")
    servings = max(1, int(re.sub(r"\D", "", str(raw_servings)) or "4"))

    raw_ingredients = d.get("recipeIngredient", [])
    ingredients = [_parse_ingredient_line(r) for r in raw_ingredients if r.strip()]

    for ing in ingredients:
        ing["quantity_per_portion"] = round(ing["quantity"] / servings, 4)
        ing["original_servings"] = servings

    instructions_raw = d.get("recipeInstructions", [])
    if isinstance(instructions_raw, str):
        instructions = instructions_raw.strip()
    elif isinstance(instructions_raw, list):
        instructions = "\n".join(
            (s.get("text", "") if isinstance(s, dict) else str(s)).strip()
            for s in instructions_raw
        )
    else:
        instructions = ""

    return {
        "url": url,
        "marmiton_id": _extract_marmiton_id(url),
        "title": title,
        "image_url": image or None,
        "instructions": instructions,
        "original_servings": servings,
        "ingredients": ingredients,
        "prep_time_min": parse_duration(d.get("prepTime")),
        "cook_time_min": parse_duration(d.get("cookTime")),
        "difficulty": None,
    }


async def _parse_css(url: str, page) -> dict | None:
    """Fallback CSS scraping if JSON-LD is absent or has no title."""
    try:
        title = await page.text_content("h1", timeout=5000) or ""
        title = title.strip()

        raw_ingredients = await page.evaluate("""() => {
            const items = document.querySelectorAll('[class*="ingredient"]');
            return Array.from(items).map(el => el.innerText.trim()).filter(Boolean);
        }""")

        servings_text = await page.text_content('[class*="portion"]', timeout=3000) or "4"
        servings = max(1, int(re.sub(r"\D", "", servings_text) or "4"))

        instructions_els = await page.evaluate("""() => {
            const steps = document.querySelectorAll('[class*="step"], [class*="etape"]');
            return Array.from(steps).map(el => el.innerText.trim()).filter(Boolean);
        }""")

        if not title or not raw_ingredients:
            return None

        ingredients = [_parse_ingredient_line(r) for r in raw_ingredients]
        for ing in ingredients:
            ing["quantity_per_portion"] = round(ing["quantity"] / servings, 4)
            ing["original_servings"] = servings

        return {
            "url": url,
            "marmiton_id": _extract_marmiton_id(url),
            "title": title,
            "image_url": None,
            "instructions": "\n".join(instructions_els),
            "original_servings": servings,
            "ingredients": ingredients,
            "prep_time_min": None,
            "cook_time_min": None,
            "difficulty": None,
        }
    except Exception as e:
        logger.warning(f"CSS fallback failed for {url}: {e}")
        return None
