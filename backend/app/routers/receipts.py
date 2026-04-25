import shutil
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.ingredient import IngredientMaster
from app.models.receipt import ReceiptScan, ReceiptItem
from app.models.store import StoreProduct
from app.utils.time import utcnow
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


# ─── Stats / tendances (declared BEFORE /{scan_id} so they don't collide) ───


class WeeklyTotal(BaseModel):
    week: str
    total: float
    count: int


class TopIngredient(BaseModel):
    ingredient_id: int
    name: str
    total: float
    qty_times: int


class PriceAlert(BaseModel):
    ingredient_id: int
    name: str
    avg_ticket_unit_price: float
    maxi_unit_price: float
    delta_pct: float


class ReceiptStats(BaseModel):
    months: int
    totals: dict
    weekly: list[WeeklyTotal]
    top_ingredients: list[TopIngredient]
    price_alerts: list[PriceAlert]


def _iso_week(dt: datetime) -> str:
    y, w, _ = dt.isocalendar()
    return f"{y}-W{w:02d}"


@router.get("/stats", response_model=ReceiptStats)
async def receipt_stats(
    months: int = Query(6, ge=1, le=24),
    db: AsyncSession = Depends(get_db),
):
    cutoff = utcnow() - timedelta(days=months * 31)
    scans = (
        await db.execute(
            select(ReceiptScan)
            .options(selectinload(ReceiptScan.items))
            .where(ReceiptScan.created_at >= cutoff)
            .where(ReceiptScan.status == "completed")
        )
    ).scalars().all()

    weekly_map: dict[str, dict] = {}
    for scan in scans:
        wk = _iso_week(scan.created_at)
        bucket = weekly_map.setdefault(wk, {"total": 0.0, "count": 0})
        bucket["total"] += scan.total_amount or 0.0
        bucket["count"] += 1
    weekly = [
        WeeklyTotal(week=wk, total=round(d["total"], 2), count=d["count"])
        for wk, d in sorted(weekly_map.items())
    ]

    now = utcnow()
    this_month = sum(
        (s.total_amount or 0.0) for s in scans
        if s.created_at.year == now.year and s.created_at.month == now.month
    )
    last_month_dt = now.replace(day=1) - timedelta(days=1)
    last_month = sum(
        (s.total_amount or 0.0) for s in scans
        if s.created_at.year == last_month_dt.year and s.created_at.month == last_month_dt.month
    )
    avg_weekly = (sum(w.total for w in weekly) / max(1, len(weekly))) if weekly else 0.0

    ing_totals: dict[int, dict] = {}
    for scan in scans:
        for it in scan.items:
            if it.ingredient_master_id is None or it.total_price is None:
                continue
            b = ing_totals.setdefault(it.ingredient_master_id, {"total": 0.0, "qty_times": 0})
            b["total"] += it.total_price
            b["qty_times"] += 1

    ing_ids = list(ing_totals.keys())
    names: dict[int, str] = {}
    if ing_ids:
        rows = (
            await db.execute(
                select(IngredientMaster.id, IngredientMaster.display_name_fr, IngredientMaster.canonical_name)
                .where(IngredientMaster.id.in_(ing_ids))
            )
        ).all()
        names = {r[0]: (r[1] or r[2]) for r in rows}

    top_ingredients = sorted(
        [
            TopIngredient(
                ingredient_id=iid,
                name=names.get(iid, f"#{iid}"),
                total=round(d["total"], 2),
                qty_times=d["qty_times"],
            )
            for iid, d in ing_totals.items()
        ],
        key=lambda x: x.total,
        reverse=True,
    )[:10]

    price_alerts: list[PriceAlert] = []
    sp_by_ing: dict[int, list[StoreProduct]] = {}
    if ing_ids:
        sps = (
            await db.execute(
                select(StoreProduct)
                .where(StoreProduct.ingredient_master_id.in_(ing_ids))
                .where(StoreProduct.price.isnot(None))
            )
        ).scalars().all()
        for sp in sps:
            sp_by_ing.setdefault(sp.ingredient_master_id, []).append(sp)

    for iid in ing_ids:
        ticket_unit_prices: list[float] = []
        for scan in scans:
            for it in scan.items:
                if it.ingredient_master_id != iid:
                    continue
                up = it.unit_price
                if up is None and it.total_price and it.quantity and it.quantity > 0:
                    up = it.total_price / it.quantity
                if up is not None and up > 0:
                    ticket_unit_prices.append(up)
        if len(ticket_unit_prices) < 2:
            continue
        avg_ticket = sum(ticket_unit_prices) / len(ticket_unit_prices)
        sps = sp_by_ing.get(iid) or []
        maxi_prices = [sp.price for sp in sps if sp.price is not None]
        if not maxi_prices:
            continue
        maxi_price = min(maxi_prices)
        if maxi_price <= 0:
            continue
        delta = (avg_ticket - maxi_price) / maxi_price * 100.0
        if delta >= 10.0:
            price_alerts.append(
                PriceAlert(
                    ingredient_id=iid,
                    name=names.get(iid, f"#{iid}"),
                    avg_ticket_unit_price=round(avg_ticket, 2),
                    maxi_unit_price=round(maxi_price, 2),
                    delta_pct=round(delta, 1),
                )
            )
    price_alerts.sort(key=lambda a: a.delta_pct, reverse=True)
    price_alerts = price_alerts[:10]

    return ReceiptStats(
        months=months,
        totals={
            "this_month": round(this_month, 2),
            "last_month": round(last_month, 2),
            "avg_weekly": round(avg_weekly, 2),
        },
        weekly=weekly,
        top_ingredients=top_ingredients,
        price_alerts=price_alerts,
    )


# ─── Smart suggestion for OCR line → ingredient (also before /{scan_id}) ────


class SuggestionHit(BaseModel):
    ingredient_id: int
    name: str
    canonical_name: str
    confidence: float
    maxi_price: float | None
    maxi_format_qty: float | None
    maxi_format_unit: str | None


@router.get("/suggest", response_model=list[SuggestionHit])
async def suggest_ingredient(
    raw_name: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
):
    """Fuzzy matcher: signature match first, then ILIKE / token overlap.

    Returns up to 5 candidates with a confidence score so the frontend can
    auto-accept high-confidence matches and offer the rest as suggestions.
    """
    from app.services.ingredient_resolution import signature

    raw = raw_name.strip()
    if not raw:
        return []
    raw_sig = signature(raw.replace(" ", "_"))

    parents = (
        await db.execute(
            select(IngredientMaster)
            .where(IngredientMaster.parent_id.is_(None))
            .where(IngredientMaster.price_mapping_status != "invalid")
        )
    ).scalars().all()

    scored: list[tuple[float, IngredientMaster]] = []
    for p in parents:
        p_sig = signature(p.canonical_name)
        score = 0.0
        if p_sig and p_sig == raw_sig:
            score = 1.0
        elif p_sig and raw_sig and (p_sig in raw_sig or raw_sig in p_sig):
            score = 0.7
        else:
            tokens_raw = {t for t in raw.lower().split() if len(t) >= 3}
            tokens_p = {
                t for t in (p.display_name_fr or p.canonical_name or "").lower().replace("_", " ").split()
                if len(t) >= 3
            }
            if tokens_raw and tokens_p:
                overlap = tokens_raw & tokens_p
                if overlap:
                    score = 0.4 + 0.1 * len(overlap)
        if score > 0.3:
            scored.append((min(score, 1.0), p))

    scored.sort(key=lambda t: t[0], reverse=True)
    scored = scored[:5]

    hit_ids = [p.id for _, p in scored]
    sp_map: dict[int, StoreProduct] = {}
    if hit_ids:
        sps = (
            await db.execute(
                select(StoreProduct).where(StoreProduct.ingredient_master_id.in_(hit_ids))
            )
        ).scalars().all()
        for sp in sps:
            cur = sp_map.get(sp.ingredient_master_id)
            if cur is None or (sp.price is not None and cur.price is None):
                sp_map[sp.ingredient_master_id] = sp

    return [
        SuggestionHit(
            ingredient_id=p.id,
            name=p.display_name_fr or p.canonical_name,
            canonical_name=p.canonical_name,
            confidence=round(conf, 2),
            maxi_price=sp_map.get(p.id).price if sp_map.get(p.id) else None,
            maxi_format_qty=sp_map.get(p.id).format_qty if sp_map.get(p.id) else None,
            maxi_format_unit=sp_map.get(p.id).format_unit if sp_map.get(p.id) else None,
        )
        for conf, p in scored
    ]


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
