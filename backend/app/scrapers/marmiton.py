"""
Marmiton recipe scraper using Playwright.
scrape_recipe(url) → dict | None
"""
import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)


def _extract_marmiton_id(url: str) -> str | None:
    m = re.search(r"_(\d+)\.aspx", url)
    return m.group(1) if m else None


def _parse_ingredient_line(raw: str) -> dict:
    """Parse '200 g de farine' → {raw_text, quantity, unit, name_raw}"""
    raw = raw.strip()
    # Match: optional number + optional unit + rest
    # Strip leading bullet characters (Marmiton occasionally prefixes "- " or "• ")
    raw_stripped = re.sub(r"^[\-\u2022\u00b7\u2043\*]+\s*", "", raw)
    m = re.match(
        r"^([\d.,/]+)?\s*"
        r"(kg|g|gramme|grammes|l|litre|litres|ml|cl|dl|tasse|cuill?[\w.]*|c\.?s\.?|c\.?c\.?|lb|oz|pincée|pincees)\b\s*"
        r"(?:d[eu]s?\s*|d'|d\u2019)?"
        r"(.+)$",
        raw_stripped,
        re.IGNORECASE,
    )
    if not m:
        # Fall back: unit optional — retry without the unit requirement.
        m = re.match(
            r"^([\d.,/]+)?\s*"
            r"(?:d[eu]s?\s*|d'|d\u2019)?"
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
            return {
                "raw_text": raw,
                "quantity": qty,
                "unit": "unite",
                "name_raw": name_raw.strip(),
            }
        return {"raw_text": raw, "quantity": 1.0, "unit": "unite", "name_raw": raw_stripped}
    if m:
        qty_str, unit, name_raw = m.group(1), m.group(2), m.group(3)
        try:
            qty = float(qty_str.replace(",", ".")) if qty_str else 1.0
        except ValueError:
            qty = 1.0
        return {
            "raw_text": raw,
            "quantity": qty,
            "unit": unit.lower() if unit else "unite",
            "name_raw": name_raw.strip(),
        }
    return {"raw_text": raw, "quantity": 1.0, "unit": "unite", "name_raw": raw}


async def scrape_recipe(url: str, page) -> dict | None:
    """
    Scrape a single Marmiton recipe URL.
    `page` is a Playwright Page object.
    Returns a dict or None on error.
    """
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=25000)

        # Try JSON-LD first (fastest + most reliable)
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
            return _parse_json_ld(url, json_ld)

        # Fallback: CSS selectors
        return await _parse_css(url, page)

    except Exception as e:
        logger.warning(f"scrape_recipe error for {url}: {e}")
        return None


def _parse_json_ld(url: str, d: dict) -> dict:
    def parse_duration(iso: str | None) -> int | None:
        if not iso:
            return None
        m = re.search(r"PT(?:(\d+)H)?(?:(\d+)M)?", iso)
        if m:
            h, mn = int(m.group(1) or 0), int(m.group(2) or 0)
            return h * 60 + mn
        return None

    title = d.get("name", "").strip()
    image = d.get("image")
    if isinstance(image, list):
        image = image[0]
    if isinstance(image, dict):
        image = image.get("url", "")

    raw_servings = d.get("recipeYield", "4")
    servings = int(re.sub(r"\D", "", str(raw_servings)) or "4") or 4

    raw_ingredients = d.get("recipeIngredient", [])
    ingredients = [_parse_ingredient_line(r) for r in raw_ingredients if r.strip()]

    # Normalize quantities to 1 portion
    for ing in ingredients:
        ing["quantity_per_portion"] = round(ing["quantity"] / servings, 4)
        ing["original_servings"] = servings

    instructions_raw = d.get("recipeInstructions", [])
    if isinstance(instructions_raw, str):
        instructions = instructions_raw.strip()
    elif isinstance(instructions_raw, list):
        steps = []
        for s in instructions_raw:
            text = s.get("text", "") if isinstance(s, dict) else str(s)
            steps.append(text.strip())
        instructions = "\n".join(steps)
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
    """Fallback CSS scraping if JSON-LD is absent."""
    try:
        title = await page.text_content("h1", timeout=5000) or ""
        title = title.strip()

        raw_ingredients = await page.evaluate("""() => {
            const items = document.querySelectorAll('[class*="ingredient"]');
            return Array.from(items).map(el => el.innerText.trim()).filter(Boolean);
        }""")

        servings_text = await page.text_content('[class*="portion"]', timeout=3000) or "4"
        servings = int(re.sub(r"\D", "", servings_text) or "4") or 4

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
