from datetime import datetime
from sqlalchemy import Integer, String, Boolean, Float, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Batch(Base):
    __tablename__ = "batch"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("user.id", ondelete="SET NULL"), index=True)
    name: Mapped[str | None] = mapped_column(String)
    target_portions: Mapped[int] = mapped_column(Integer, default=20)
    generated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    status: Mapped[str] = mapped_column(String, default="draft")  # draft|shopping|cooking|done
    total_estimated_cost: Mapped[float | None] = mapped_column(Float)
    total_portions: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(String)

    batch_recipes: Mapped[list["BatchRecipe"]] = relationship(
        back_populates="batch", cascade="all, delete-orphan"
    )
    shopping_items: Mapped[list["ShoppingListItem"]] = relationship(
        back_populates="batch", cascade="all, delete-orphan"
    )


class BatchRecipe(Base):
    __tablename__ = "batch_recipe"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[int] = mapped_column(Integer, ForeignKey("batch.id", ondelete="CASCADE"), nullable=False)
    recipe_id: Mapped[int] = mapped_column(Integer, ForeignKey("recipe.id"), nullable=False)
    portions: Mapped[int] = mapped_column(Integer, default=7)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    batch: Mapped["Batch"] = relationship(back_populates="batch_recipes")
    recipe: Mapped["Recipe"] = relationship(back_populates="batch_recipes")  # noqa


class ShoppingListItem(Base):
    __tablename__ = "shopping_list_item"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[int] = mapped_column(Integer, ForeignKey("batch.id", ondelete="CASCADE"), nullable=False)
    ingredient_master_id: Mapped[int] = mapped_column(Integer, ForeignKey("ingredient_master.id"), nullable=False)
    store_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store.id"))
    store_product_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_product.id"))

    quantity_needed: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String)
    format_qty: Mapped[float | None] = mapped_column(Float)
    format_unit: Mapped[str | None] = mapped_column(String)
    packages_to_buy: Mapped[int] = mapped_column(Integer, default=1)
    estimated_cost: Mapped[float | None] = mapped_column(Float)
    from_inventory_qty: Mapped[float] = mapped_column(Float, default=0.0)
    product_url: Mapped[str | None] = mapped_column(String, nullable=True)

    is_purchased: Mapped[bool] = mapped_column(Boolean, default=False)
    purchased_at: Mapped[datetime | None] = mapped_column(DateTime)

    batch: Mapped["Batch"] = relationship(back_populates="shopping_items")
    ingredient: Mapped["IngredientMaster"] = relationship()  # noqa
    store: Mapped["Store | None"] = relationship()  # noqa
    store_product: Mapped["StoreProduct | None"] = relationship()  # noqa
