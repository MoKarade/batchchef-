from datetime import datetime
from sqlalchemy import Integer, String, Boolean, Float, DateTime, ForeignKey, func, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Store(Base):
    __tablename__ = "store"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String, unique=True, nullable=False)  # maxi (V3 is Maxi-only)
    name: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, default="supermarket")
    website_url: Mapped[str | None] = mapped_column(String)
    store_location_id: Mapped[str | None] = mapped_column(String)  # Maxi store 8676
    is_transactional: Mapped[bool] = mapped_column(Boolean, default=True)

    products: Mapped[list["StoreProduct"]] = relationship(back_populates="store")  # noqa

    def __repr__(self) -> str:
        return f"<Store id={self.id} code={self.code!r} type={self.type}>"


class StoreProduct(Base):
    __tablename__ = "store_product"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ingredient_master_id: Mapped[int] = mapped_column(Integer, ForeignKey("ingredient_master.id"), nullable=False)
    store_id: Mapped[int] = mapped_column(Integer, ForeignKey("store.id"), nullable=False)
    product_name: Mapped[str | None] = mapped_column(String)
    product_url: Mapped[str | None] = mapped_column(String)
    image_url: Mapped[str | None] = mapped_column(String)
    sku: Mapped[str | None] = mapped_column(String)
    price: Mapped[float | None] = mapped_column(Float)
    format_qty: Mapped[float | None] = mapped_column(Float)   # 500
    format_unit: Mapped[str | None] = mapped_column(String)   # g

    # Nutrition per 100g/100ml
    calories_per_100: Mapped[float | None] = mapped_column(Float)
    proteins_per_100: Mapped[float | None] = mapped_column(Float)
    carbs_per_100: Mapped[float | None] = mapped_column(Float)
    lipids_per_100: Mapped[float | None] = mapped_column(Float)
    nutriscore: Mapped[str | None] = mapped_column(String)  # A|B|C|D|E

    # Quality / validation
    is_validated: Mapped[bool] = mapped_column(Boolean, default=False)
    confidence_score: Mapped[float | None] = mapped_column(Float)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_price_change_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    ingredient: Mapped["IngredientMaster"] = relationship(back_populates="store_products")  # noqa
    store: Mapped["Store"] = relationship(back_populates="products")
    price_history: Mapped[list["PriceHistory"]] = relationship(back_populates="product")

    __table_args__ = (
        UniqueConstraint("ingredient_master_id", "store_id", "sku", name="uq_product_store_sku"),
    )

    def __repr__(self) -> str:
        return (
            f"<StoreProduct id={self.id} store={self.store_id} ing={self.ingredient_master_id} "
            f"price={self.price} validated={self.is_validated}>"
        )


class PriceHistory(Base):
    __tablename__ = "price_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    store_product_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_product.id", ondelete="CASCADE"))
    price: Mapped[float] = mapped_column(Float, nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    product: Mapped["StoreProduct"] = relationship(back_populates="price_history")


Index("ix_sp_ingredient", StoreProduct.ingredient_master_id)
Index("ix_sp_store", StoreProduct.store_id)
