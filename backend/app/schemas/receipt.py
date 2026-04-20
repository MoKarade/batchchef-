from datetime import datetime
from pydantic import BaseModel, ConfigDict


class ReceiptItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    raw_name: str | None = None
    ingredient_master_id: int | None = None
    quantity: float | None = None
    unit: str | None = None
    unit_price: float | None = None
    total_price: float | None = None
    confidence: float | None = None
    is_confirmed: bool = False


class ReceiptScanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    image_path: str
    store_id: int | None = None
    scanned_at: datetime | None = None
    total_amount: float | None = None
    status: str
    error_message: str | None = None
    created_at: datetime
    items: list[ReceiptItemOut] = []


class ReceiptConfirmRequest(BaseModel):
    confirmed_item_ids: list[int]


class ReceiptItemUpdate(BaseModel):
    raw_name: str | None = None
    ingredient_master_id: int | None = None
    quantity: float | None = None
    unit: str | None = None
    unit_price: float | None = None
    total_price: float | None = None


class ReceiptItemCreate(BaseModel):
    raw_name: str | None = None
    ingredient_master_id: int | None = None
    quantity: float | None = None
    unit: str | None = None
    unit_price: float | None = None
    total_price: float | None = None
