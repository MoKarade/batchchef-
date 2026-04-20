"""Shared utilities for supermarket scrapers (Maxi, Costco, ...)."""
import logging
import re
import unicodedata
from typing import Any

logger = logging.getLogger(__name__)


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9\s]", "", s)


def is_relevant(query: str, product_name: str, threshold: float = 0.6) -> bool:
    if not product_name:
        return False
    q_words = [w for w in norm(query).split() if len(w) >= 2]
    p = norm(product_name)
    if not q_words:
        return norm(query) in p
    for w in q_words:
        if len(w) <= 3 and not re.search(rf"\b{re.escape(w)}\b", p):
            return False
    matches = sum(1 for w in q_words if re.search(rf"\b{re.escape(w)}\b", p))
    return (matches / len(q_words)) >= threshold


def parse_format(name: str) -> dict[str, Any]:
    if not name:
        return {"qty": 1, "unit": "unite"}
    m = re.search(r"(\d+)\s*x\s*(\d+[.,]?\d*)\s*(g|kg|ml|l|lb|oz)\b", name, re.I)
    if m:
        total = float(m.group(1)) * float(m.group(2).replace(",", "."))
        return {"qty": round(total, 2), "unit": m.group(3).lower()}
    m = re.search(r"(\d+[.,]?\d*)\s*(g|kg|ml|l|lb|oz)\b", name, re.I)
    if m:
        return {"qty": float(m.group(1).replace(",", ".")), "unit": m.group(2).lower()}
    return {"qty": 1, "unit": "unite"}


async def fetch_nutrition_openfoodfacts(query: str) -> dict:
    """Fetch nutrition per 100g from OpenFoodFacts (free, no auth)."""
    import httpx
    url = (
        f"https://world.openfoodfacts.org/cgi/search.pl?action=process&json=1"
        f"&search_terms={query}&fields=nutriments,nutriscore_grade&lc=fr&page_size=3"
    )
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url, headers={
                "User-Agent": "BatchChef/2.0 (meal-prep planner; contact@batchchef.local)"
            })
            data = resp.json()
            products = [p for p in (data.get("products") or []) if p.get("nutriments")]
            if not products:
                return {}
            n = products[0]["nutriments"]
            kcal_raw = n.get("energy-kcal_100g") or (n.get("energy_100g", 0) / 4.184)
            return {
                "calories": round(float(kcal_raw or 0)),
                "proteins": round(float(n.get("proteins_100g") or 0), 1),
                "carbs": round(float(n.get("carbohydrates_100g") or 0), 1),
                "lipids": round(float(n.get("fat_100g") or 0), 1),
                "nutriscore": products[0].get("nutriscore_grade"),
            }
    except Exception as e:
        logger.debug(f"OpenFoodFacts error for '{query}': {e}")
        return {}


async def try_accept_cookies(page) -> None:
    """Best-effort cookie consent dismissal."""
    try:
        for sel in [
            "#onetrust-accept-btn-handler",
            "[id*='accept-all']",
            "[class*='accept-all']",
            "button:has-text('Accepter')",
            "button:has-text('Accept')",
        ]:
            btn = page.locator(sel).first
            if await btn.count() > 0:
                await btn.click(timeout=3000)
                await page.wait_for_timeout(1500)
                break
    except Exception:
        pass
