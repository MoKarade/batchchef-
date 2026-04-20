"""Celery task: OCR a receipt image and store extracted items."""
import asyncio
import logging
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="receipt.process")
def run_receipt_ocr(self, scan_id: int, image_path: str):
    asyncio.run(_run(scan_id, image_path))


async def _run(scan_id: int, image_path: str):
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models.receipt import ReceiptScan, ReceiptItem
    from app.models.ingredient import IngredientMaster
    from app.ai.receipt_ocr import ocr_receipt

    items_data = await ocr_receipt(image_path)

    async with AsyncSessionLocal() as db:
        scan = await db.get(ReceiptScan, scan_id)
        if not scan:
            return

        total = 0.0
        for item_data in items_data:
            canonical = item_data.get("canonical_name", "").strip().lower()
            ing_id = None

            if canonical:
                ing = (
                    await db.execute(select(IngredientMaster).where(IngredientMaster.canonical_name == canonical))
                ).scalar_one_or_none()
                if ing:
                    ing_id = ing.id

            ri = ReceiptItem(
                receipt_scan_id=scan_id,
                raw_name=item_data.get("raw_name"),
                ingredient_master_id=ing_id,
                quantity=item_data.get("quantity"),
                unit=item_data.get("unit"),
                unit_price=item_data.get("unit_price"),
                total_price=item_data.get("total_price"),
                confidence=0.8 if ing_id else 0.4,
            )
            db.add(ri)
            total += item_data.get("total_price") or 0.0

        scan.status = "completed"
        scan.total_amount = round(total, 2)
        scan.raw_ocr_text = str(items_data)
        await db.commit()

    logger.info(f"Receipt {scan_id} processed: {len(items_data)} items")
