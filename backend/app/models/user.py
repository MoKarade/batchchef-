from datetime import datetime
from sqlalchemy import Integer, String, Boolean, DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class User(Base):
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # Maxi.ca credentials — email in the clear so we can show it in
    # settings; password is Fernet-encrypted (``app.utils.crypto``). Both
    # NULL until the user opts in via /settings.
    maxi_email: Mapped[str | None] = mapped_column(String, nullable=True)
    maxi_password_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Google Tasks OAuth — tokens from the "sign in with Google" flow used
    # by the "Exporter vers Google Tasks" button. Only the Tasks scope is
    # requested (no Gmail/Drive). Refresh token is long-lived; access token
    # is re-minted as needed via /oauth2/token.
    google_email: Mapped[str | None] = mapped_column(String, nullable=True)
    google_refresh_token_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    google_access_token_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    google_access_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    def __repr__(self) -> str:
        # email exposed in repr — single-user local deployment, not a leak risk.
        return f"<User id={self.id} email={self.email!r} admin={self.is_admin}>"
