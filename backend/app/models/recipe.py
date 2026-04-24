from datetime import datetime
from sqlalchemy import Integer, String, Boolean, Float, DateTime, Text, ForeignKey, JSON, func, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Recipe(Base):
    __tablename__ = "recipe"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    marmiton_url: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    marmiton_id: Mapped[str | None] = mapped_column(String)
    title: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str | None] = mapped_column(String, index=True)
    image_url: Mapped[str | None] = mapped_column(String)
    instructions: Mapped[str | None] = mapped_column(Text)
    servings: Mapped[int] = mapped_column(Integer, default=1)  # always 1 after normalization
    prep_time_min: Mapped[int | None] = mapped_column(Integer)
    cook_time_min: Mapped[int | None] = mapped_column(Integer)
    difficulty: Mapped[str | None] = mapped_column(String)  # facile|moyen|difficile

    # AI tags
    meal_type: Mapped[str | None] = mapped_column(String)  # entree|plat|dessert|snack
    is_sweet: Mapped[bool] = mapped_column(Boolean, default=False)
    is_salty: Mapped[bool] = mapped_column(Boolean, default=False)
    is_spicy: Mapped[bool] = mapped_column(Boolean, default=False)
    is_vegetarian: Mapped[bool] = mapped_column(Boolean, default=False)
    is_vegan: Mapped[bool] = mapped_column(Boolean, default=False)
    cuisine_type: Mapped[str | None] = mapped_column(String)
    tags_json: Mapped[str | None] = mapped_column(Text)  # JSON array

    # Nutrition (per 1 portion)
    calories_per_portion: Mapped[float | None] = mapped_column(Float)
    proteins_per_portion: Mapped[float | None] = mapped_column(Float)
    carbs_per_portion: Mapped[float | None] = mapped_column(Float)
    lipids_per_portion: Mapped[float | None] = mapped_column(Float)
    estimated_cost_per_portion: Mapped[float | None] = mapped_column(Float)
    health_score: Mapped[float | None] = mapped_column(Float)

    # Workflow
    scraped_at: Mapped[datetime | None] = mapped_column(DateTime)
    ai_processed_at: Mapped[datetime | None] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String, default="pending")  # pending|scraped|ai_done|error
    pricing_status: Mapped[str] = mapped_column(String, default="pending")  # pending|complete|incomplete
    missing_price_ingredients: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text)

    # User annotations — free-form notes shown on the recipe detail page
    # ("ajouter 10% plus de crème", "trop épicé pour les kids"). Distinct
    # from ``instructions`` (scraped from Marmiton) and ``error_message``
    # (import pipeline).
    user_notes: Mapped[str | None] = mapped_column(Text)
    # Simple star/favorite flag. An actual multi-user rating system is
    # overkill for now — one bit per user gets 95% of the value.
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    ingredients: Mapped[list["RecipeIngredient"]] = relationship(  # noqa
        back_populates="recipe", cascade="all, delete-orphan"
    )
    batch_recipes: Mapped[list["BatchRecipe"]] = relationship(back_populates="recipe")  # noqa


class RecipeIngredient(Base):
    __tablename__ = "recipe_ingredient"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    recipe_id: Mapped[int] = mapped_column(Integer, ForeignKey("recipe.id", ondelete="CASCADE"), nullable=False)
    ingredient_master_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("ingredient_master.id"))
    raw_text: Mapped[str | None] = mapped_column(String)  # "2 gousses d'ail hachées"
    quantity_per_portion: Mapped[float | None] = mapped_column(Float)  # normalized (÷ original portions)
    unit: Mapped[str | None] = mapped_column(String)  # g|ml|unite|gousse
    note: Mapped[str | None] = mapped_column(String)  # "hachée", "pelée"
    order_index: Mapped[int] = mapped_column(Integer, default=0)

    recipe: Mapped["Recipe"] = relationship(back_populates="ingredients")  # noqa
    ingredient: Mapped["IngredientMaster | None"] = relationship(back_populates="recipe_ingredients")  # noqa


Index("ix_ri_recipe", RecipeIngredient.recipe_id)
Index("ix_ri_ingredient", RecipeIngredient.ingredient_master_id)
