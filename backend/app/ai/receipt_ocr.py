"""
OCR a receipt image via Gemini Vision.
Returns structured list of items.
"""
import asyncio
import logging
from pathlib import Path
from google.genai import types
from app.ai.client import get_client
from app.ai.utils import parse_gemini_json
from app.config import settings

logger = logging.getLogger(__name__)

OCR_PROMPT = """Analyse ce ticket de caisse. Extrais chaque article acheté et réponds UNIQUEMENT
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
    client = get_client()
    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"Receipt image not found: {image_path}")

    with open(path, "rb") as f:
        image_bytes = f.read()

    suffix = path.suffix.lower().lstrip(".")
    mime_type = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png"}.get(suffix, "image/jpeg")

    for attempt in range(5):
        try:
            await asyncio.sleep(4)
            response = client.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                    OCR_PROMPT,
                ],
            )
            result = parse_gemini_json(response.text)
            if isinstance(result, list):
                return result
            raise ValueError("Expected a JSON array")
        except Exception as e:
            is_rate_limit = "429" in str(e) or "quota" in str(e).lower() or "rate" in str(e).lower()
            if attempt < 4:
                wait = min(60 * (2 ** attempt), 300) if is_rate_limit else 5
                logger.warning(f"OCR attempt {attempt + 1}/5 for '{image_path}' failed ({e}), retrying in {wait}s")
                await asyncio.sleep(wait)
            else:
                logger.error(f"OCR failed after 5 attempts for {image_path}: {e}")
    return []
