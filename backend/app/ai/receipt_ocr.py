"""OCR a receipt image via Claude Vision."""
import asyncio
import logging
from pathlib import Path
from app.ai.client import call_claude_vision
from app.ai.utils import parse_json_response

logger = logging.getLogger(__name__)

OCR_SYSTEM = """Analyse ce ticket de caisse. Extrais chaque article acheté et réponds UNIQUEMENT
avec un JSON array valide (sans markdown):
[
  {
    "raw_name": "nom exact sur le ticket",
    "canonical_name": "nom standardisé en français (ex: ail, lait_2%, pomme_gala)",
    "quantity": 1.0,
    "unit": "unite|kg|g|l|ml",
    "unit_price": 2.99,
    "total_price": 2.99
  }
]
Si une valeur est inconnue, mets null. Ignore les lignes non alimentaires (taxes, sous-total, etc.)."""


async def ocr_receipt(image_path: str) -> list[dict]:
    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"Receipt image not found: {image_path}")

    image_bytes = path.read_bytes()
    suffix = path.suffix.lower().lstrip(".")
    mime_type = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png"}.get(suffix, "image/jpeg")

    for attempt in range(3):
        try:
            text = await call_claude_vision(
                OCR_SYSTEM,
                "Extrait les articles de ce ticket.",
                image_bytes,
                mime_type,
            )
            result = parse_json_response(text)
            if isinstance(result, list):
                return result
            raise ValueError("Expected a JSON array")
        except Exception as e:
            if attempt < 2:
                wait = 5 * (2 ** attempt)
                logger.warning(f"OCR attempt {attempt + 1}/3 for '{image_path}' failed ({e}), retrying in {wait}s")
                await asyncio.sleep(wait)
            else:
                logger.error(f"OCR failed after 3 attempts for {image_path}: {e}")
    return []
