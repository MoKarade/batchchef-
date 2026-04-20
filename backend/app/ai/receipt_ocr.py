"""
OCR a receipt image via Gemini 2.0 Flash Vision.
Returns structured list of items.
"""
import json
import logging
from pathlib import Path
from google import genai
from google.genai import types
from app.ai.client import get_client
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

    # Upload image
    with open(path, "rb") as f:
        image_bytes = f.read()

    suffix = path.suffix.lower().lstrip(".")
    mime_type = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png"}.get(suffix, "image/jpeg")

    try:
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                OCR_PROMPT,
            ],
        )
        text = response.text.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])
        return json.loads(text)
    except Exception as e:
        logger.error(f"OCR failed for {image_path}: {e}")
        return []
