from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, ConfigDict


class InventoryItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    ingredient_master_id: int
    quantity: float
    unit: str
    purchased_at: datetime | None = None
    expires_at: datetime | None = None
    notes: str | None = None
    updated_at: datetime
    ingredient: IngredientRef | None = None


class IngredientRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    canonical_name: str
    display_name_fr: str


class InventoryItemCreate(BaseModel):
    ingredient_master_id: int
    quantity: float
    unit: str
    purchased_at: datetime | None = None
    expires_at: datetime | None = None
    notes: str | None = None


class InventoryItemUpdate(BaseModel):
    quantity: float | None = None
    unit: str | None = None
    notes: str | None = None
    expires_at: datetime | None = None


class MovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    ingredient_master_id: int
    change_qty: float
    unit: str
    movement_type: str
    source_ref_type: str | None = None
    source_ref_id: int | None = None
    created_at: datetime
