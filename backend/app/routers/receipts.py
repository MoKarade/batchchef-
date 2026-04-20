import shutil
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.receipt import ReceiptScan, ReceiptItem
from app.schemas.receipt import (
    ReceiptScanOut,
    ReceiptItemOut,
    ReceiptConfirmRequest,
    ReceiptItemUpdate,
    ReceiptItemCreate,
)
from app.config import settings

router = APIRouter(prefix="/api/receipts", tags=["receipts"])
UPLOADS_DIR = Path(settings.UPLOADS_DIR) / "receipts"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


@router.post("", response_model=ReceiptScanOut, status_code=201)
async def upload_receipt(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    suffix = Path(file.filename).suffix if file.filename else ".jpg"
    filename = f"{uuid.uuid4().hex}{suffix}"
    dest = UPLOADS_DIR / filename
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    scan = ReceiptScan(image_path=str(dest.relative_to(Path("."))), status="pending")
    db.add(scan)
    await db.flush()
    await db.refresh(scan)

    try:
        from app.workers.process_receipt import run_receipt_ocr
        run_receipt_ocr.delay(scan.id, str(dest))
        scan.status = "processing"
    except Exception as e:
        scan.status = "error"
        scan.error_message = str(e)

    await db.commit()
    await db.refresh(scan)
    return scan


@router.get("", response_model=list[ReceiptScanOut])
async def list_receipts(db: AsyncSession = Depends(get_db)):
    q = select(ReceiptScan).order_by(ReceiptScan.id.desc()).limit(50)
    return (await db.execute(q)).scalars().all()


@router.get("/{scan_id}", response_model=ReceiptScanOut)
async def get_receipt(scan_id: int, db: AsyncSession = Depends(get_db)):
    q = select(ReceiptScan).options(selectinload(ReceiptScan.items)).where(ReceiptScan.id == scan_id)
    scan = (await db.execute(q)).scalar_one_or_none()
    if not scan:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return scan


@router.patch("/{scan_id}/confirm")
async def confirm_receipt(scan_id: int, body: ReceiptConfirmRequest, db: AsyncSession = Depends(get_db)):
    from app.services.inventory_manager import add_from_receipt
    await add_from_receipt(db, scan_id, body.confirmed_item_ids)
    return {"status": "confirmed", "scan_id": scan_id}


@router.post("/{scan_id}/items", response_model=ReceiptItemOut, status_code=201)
async def add_item(
    scan_id: int,
    body: ReceiptItemCreate,
    db: AsyncSession = Depends(get_db),
):
    scan = await db.get(ReceiptScan, scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Receipt not found")
    item = ReceiptItem(receipt_scan_id=scan_id, **body.model_dump(exclude_unset=True))
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.patch("/{scan_id}/items/{item_id}", response_model=ReceiptItemOut)
async def update_item(
    scan_id: int,
    item_id: int,
    body: ReceiptItemUpdate,
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(ReceiptItem, item_id)
    if not item or item.receipt_scan_id != scan_id:
        raise HTTPException(status_code=404, detail="Item not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{scan_id}/items/{item_id}", status_code=204)
async def delete_item(scan_id: int, item_id: int, db: AsyncSession = Depends(get_db)):
    item = await db.get(ReceiptItem, item_id)
    if not item or item.receipt_scan_id != scan_id:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.delete(item)
    await db.commit()
