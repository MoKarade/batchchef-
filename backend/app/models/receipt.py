from datetime import datetime
from sqlalchemy import Integer, String, Boolean, Float, DateTime, Text, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class ReceiptScan(Base):
    __tablename__ = "receipt_scan"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("user.id", ondelete="SET NULL"), index=True)
    image_path: Mapped[str] = mapped_column(String, nullable=False)
    store_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store.id"))
    scanned_at: Mapped[datetime | None] = mapped_column(DateTime)
    total_amount: Mapped[float | None] = mapped_column(Float)
    raw_ocr_text: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, default="pending")  # pending|processing|completed|error
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    store: Mapped["Store | None"] = relationship()  # noqa
    items: Mapped[list["ReceiptItem"]] = relationship(
        back_populates="scan", cascade="all, delete-orphan"
    )


class ReceiptItem(Base):
    __tablename__ = "receipt_item"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    receipt_scan_id: Mapped[int] = mapped_column(Integer, ForeignKey("receipt_scan.id", ondelete="CASCADE"))
    raw_name: Mapped[str | None] = mapped_column(String)  # "POMMES GALA 2LB"
    ingredient_master_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("ingredient_master.id"))
    matched_store_product_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_product.id"))
    quantity: Mapped[float | None] = mapped_column(Float)
    unit: Mapped[str | None] = mapped_column(String)
    unit_price: Mapped[float | None] = mapped_column(Float)
    total_price: Mapped[float | None] = mapped_column(Float)
    confidence: Mapped[float | None] = mapped_column(Float)
    is_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)

    scan: Mapped["ReceiptScan"] = relationship(back_populates="items")
    ingredient: Mapped["IngredientMaster | None"] = relationship()  # noqa
    matched_product: Mapped["StoreProduct | None"] = relationship()  # noqa
