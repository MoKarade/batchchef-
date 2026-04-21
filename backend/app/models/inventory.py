from datetime import datetime
from sqlalchemy import Integer, String, Boolean, Float, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class InventoryItem(Base):
    __tablename__ = "inventory_item"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("user.id", ondelete="SET NULL"), index=True)
    ingredient_master_id: Mapped[int] = mapped_column(Integer, ForeignKey("ingredient_master.id"), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String, nullable=False)
    source_store_product_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_product.id"))
    purchased_at: Mapped[datetime | None] = mapped_column(DateTime)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    notes: Mapped[str | None] = mapped_column(String)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    ingredient: Mapped["IngredientMaster"] = relationship(back_populates="inventory_items")  # noqa
    source_product: Mapped["StoreProduct | None"] = relationship()  # noqa
    movements: Mapped[list["InventoryMovement"]] = relationship(back_populates="item", cascade="all, delete-orphan")


class InventoryMovement(Base):
    __tablename__ = "inventory_movement"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    inventory_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("inventory_item.id"))
    ingredient_master_id: Mapped[int] = mapped_column(Integer, ForeignKey("ingredient_master.id"), nullable=False)
    change_qty: Mapped[float] = mapped_column(Float, nullable=False)  # positive=in, negative=out
    unit: Mapped[str] = mapped_column(String, nullable=False)
    movement_type: Mapped[str] = mapped_column(String)  # purchase|batch_consumption|manual_adjust|expiry|receipt_scan
    source_ref_type: Mapped[str | None] = mapped_column(String)  # batch|receipt|manual
    source_ref_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    item: Mapped["InventoryItem | None"] = relationship(back_populates="movements")
    ingredient: Mapped["IngredientMaster"] = relationship()  # noqa
