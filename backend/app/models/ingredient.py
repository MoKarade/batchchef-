from datetime import datetime
from sqlalchemy import Integer, String, Boolean, Float, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class IngredientMaster(Base):
    __tablename__ = "ingredient_master"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    canonical_name: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    display_name_fr: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str | None] = mapped_column(String)  # fruit|legume|viande|poisson|laitier|epice|feculent|conserve|noix
    subcategory: Mapped[str | None] = mapped_column(String)
    is_produce: Mapped[bool] = mapped_column(Boolean, default=False)
    default_unit: Mapped[str | None] = mapped_column(String)  # g|ml|unite
    estimated_price_per_kg: Mapped[float | None] = mapped_column(Float)

    # Parent/child hierarchy: NULL parent_id = top-level generic ingredient
    # (e.g. "Porc"), non-null = variant (e.g. "Bacon" whose parent is "Porc").
    parent_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("ingredient_master.id", ondelete="SET NULL"), index=True,
    )
    # Per-variant pricing for "per unit" items (bacon strip, single egg…),
    # layered on top of estimated_price_per_kg when the granularity is discrete.
    specific_unit: Mapped[str | None] = mapped_column(String)
    specific_price_per_unit: Mapped[float | None] = mapped_column(Float)
    # Per-variant nutrition (per 100 g or 100 ml)
    calories_per_100: Mapped[float | None] = mapped_column(Float)
    proteins_per_100: Mapped[float | None] = mapped_column(Float)
    carbs_per_100: Mapped[float | None] = mapped_column(Float)
    lipids_per_100: Mapped[float | None] = mapped_column(Float)

    price_mapping_status: Mapped[str] = mapped_column(String, default="pending")  # pending|mapped|failed
    last_price_mapping_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    parent: Mapped["IngredientMaster | None"] = relationship(
        "IngredientMaster", remote_side="IngredientMaster.id", back_populates="children",
    )
    children: Mapped[list["IngredientMaster"]] = relationship(
        "IngredientMaster", back_populates="parent",
    )

    recipe_ingredients: Mapped[list["RecipeIngredient"]] = relationship(back_populates="ingredient")  # noqa
    store_products: Mapped[list["StoreProduct"]] = relationship(back_populates="ingredient")  # noqa
    inventory_items: Mapped[list["InventoryItem"]] = relationship(back_populates="ingredient")  # noqa
