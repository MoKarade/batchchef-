from datetime import datetime
from pydantic import BaseModel, ConfigDict


class IngredientMasterBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    canonical_name: str
    display_name_fr: str
    category: str | None = None
    price_mapping_status: str = "pending"


class RecipeIngredientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    raw_text: str | None = None
    quantity_per_portion: float | None = None
    unit: str | None = None
    note: str | None = None
    order_index: int = 0
    ingredient: IngredientMasterBrief | None = None


class RecipeBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    slug: str | None = None
    image_url: str | None = None
    meal_type: str | None = None
    is_sweet: bool = False
    is_salty: bool = False
    is_spicy: bool = False
    is_vegetarian: bool = False
    calories_per_portion: float | None = None
    proteins_per_portion: float | None = None
    estimated_cost_per_portion: float | None = None
    health_score: float | None = None
    status: str = "pending"
    scraped_at: datetime | None = None


class RecipeDetail(RecipeBrief):
    model_config = ConfigDict(from_attributes=True)
    marmiton_url: str
    instructions: str | None = None
    servings: int = 1
    prep_time_min: int | None = None
    cook_time_min: int | None = None
    difficulty: str | None = None
    is_vegan: bool = False
    cuisine_type: str | None = None
    tags_json: str | None = None
    carbs_per_portion: float | None = None
    lipids_per_portion: float | None = None
    ai_processed_at: datetime | None = None
    ingredients: list[RecipeIngredientOut] = []


class RecipeList(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[RecipeBrief]
