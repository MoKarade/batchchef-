from datetime import datetime
from pydantic import BaseModel, ConfigDict
from app.schemas.recipe import RecipeBrief


class ShoppingItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    ingredient_master_id: int
    quantity_needed: float
    unit: str
    format_qty: float | None = None
    format_unit: str | None = None
    packages_to_buy: int = 1
    estimated_cost: float | None = None
    from_inventory_qty: float = 0.0
    is_purchased: bool = False
    purchased_at: datetime | None = None
    ingredient: "IngredientBrief | None" = None
    store: "StoreBrief | None" = None


class IngredientBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    canonical_name: str
    display_name_fr: str


class StoreBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    name: str


class BatchRecipeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    recipe_id: int
    portions: int
    recipe: RecipeBrief | None = None


class BatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str | None = None
    target_portions: int
    status: str
    total_estimated_cost: float | None = None
    total_portions: int | None = None
    generated_at: datetime
    batch_recipes: list[BatchRecipeOut] = []
    shopping_items: list[ShoppingItemOut] = []


ShoppingItemOut.model_rebuild()


class BatchGenerateRequest(BaseModel):
    target_portions: int = 20
    num_recipes: int = 3
    meal_type_sequence: list[str] | None = None
    vegetarian_only: bool = False
    vegan_only: bool = False
    max_cost_per_portion: float | None = None
    prep_time_max_min: int | None = None
    health_score_min: float | None = None
    include_recipe_ids: list[int] | None = None
    exclude_recipe_ids: list[int] | None = None
