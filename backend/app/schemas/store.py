from datetime import datetime
from pydantic import BaseModel, ConfigDict


class StoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    name: str
    type: str
    website_url: str | None = None
    is_transactional: bool = True


class StorePriceUpdate(BaseModel):
    ingredient_master_id: int
    price: float
    format_qty: float
    format_unit: str  # g|kg|ml|l|unite


class StoreProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    ingredient_master_id: int
    store_id: int
    product_name: str | None = None
    product_url: str | None = None
    price: float | None = None
    format_qty: float | None = None
    format_unit: str | None = None
    calories_per_100: float | None = None
    proteins_per_100: float | None = None
    carbs_per_100: float | None = None
    lipids_per_100: float | None = None
    nutriscore: str | None = None
    is_validated: bool = False
    confidence_score: float | None = None
    last_checked_at: datetime | None = None
    last_price_change_at: datetime | None = None


class MapPricesRequest(BaseModel):
    store_codes: list[str] | None = None   # default: ['maxi', 'costco']
    ingredient_ids: list[int] | None = None  # default: all unmapped
