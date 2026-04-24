from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import create_access_token, hash_password, verify_password, get_current_user, get_optional_user
from app.database import get_db
from app.models.user import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


async def resolve_effective_user(
    current: User | None,
    db: AsyncSession,
) -> User:
    """Return the authenticated user OR — in single-user local mode where
    the frontend's auth stub doesn't send a Bearer token — fall back to
    the first admin user in the DB. All per-user settings (Maxi creds,
    Google tokens) live on this user."""
    if current:
        return current
    # Single-user fallback: prefer admins, then oldest user
    q = select(User).where(User.is_active == True).order_by(  # noqa: E712
        User.is_admin.desc(), User.id.asc(),
    ).limit(1)
    user = (await db.execute(q)).scalar_one_or_none()
    if not user:
        raise HTTPException(
            500,
            "Aucun utilisateur configuré — définis ADMIN_EMAIL + ADMIN_PASSWORD dans .env et redémarre.",
        )
    return user


class RegisterRequest(BaseModel):
    email: str
    password: str
    display_name: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    email: str
    display_name: str | None


class UserOut(BaseModel):
    id: int
    email: str
    display_name: str | None
    is_admin: bool


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Email déjà utilisé")
    if len(body.password) < 8:
        raise HTTPException(status_code=422, detail="Mot de passe trop court (8 caractères min)")

    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        display_name=body.display_name or body.email.split("@")[0],
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.id, user.email)
    return TokenResponse(access_token=token, user_id=user.id, email=user.email, display_name=user.display_name)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Compte désactivé")

    token = create_access_token(user.id, user.email)
    return TokenResponse(access_token=token, user_id=user.id, email=user.email, display_name=user.display_name)


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return UserOut(
        id=current_user.id,
        email=current_user.email,
        display_name=current_user.display_name,
        is_admin=current_user.is_admin,
    )


# ── Maxi credentials (opt-in, for auto-cart filling) ─────────────────────
class MaxiCredsUpsert(BaseModel):
    email: str
    password: str


class MaxiCredsStatus(BaseModel):
    has_creds: bool
    email: str | None = None


@router.get("/maxi-creds", response_model=MaxiCredsStatus)
async def get_maxi_creds_status(
    current: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """Return whether the user has Maxi creds stored. Never exposes the
    password — only presence + email. Falls back to the first admin in
    single-user local mode (no Bearer token from frontend)."""
    user = await resolve_effective_user(current, db)
    return MaxiCredsStatus(
        has_creds=bool(user.maxi_password_encrypted),
        email=user.maxi_email,
    )


@router.put("/maxi-creds", response_model=MaxiCredsStatus)
async def set_maxi_creds(
    body: MaxiCredsUpsert,
    current: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """Store Maxi creds encrypted. Overwrites any existing pair."""
    from app.utils.crypto import encrypt

    if not body.email or "@" not in body.email:
        raise HTTPException(422, "Email Maxi invalide")
    if not body.password or len(body.password) < 4:
        raise HTTPException(422, "Mot de passe trop court")

    user = await resolve_effective_user(current, db)
    user.maxi_email = body.email.strip().lower()
    user.maxi_password_encrypted = encrypt(body.password)
    await db.commit()
    return MaxiCredsStatus(has_creds=True, email=user.maxi_email)


@router.delete("/maxi-creds", status_code=204)
async def delete_maxi_creds(
    current: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """Wipe the stored Maxi creds."""
    user = await resolve_effective_user(current, db)
    user.maxi_email = None
    user.maxi_password_encrypted = None
    await db.commit()


# ── Google Tasks OAuth ──────────────────────────────────────────────────
# In-memory state store — maps ``state`` tokens issued during /oauth-start
# to the user_id that issued them, so the callback can verify CSRF and know
# which user to attach the tokens to. Entries expire after 10 min to bound
# memory. For a multi-instance deploy this should move to Redis but for
# our single-process dev setup a dict is fine.
_oauth_state: dict[str, tuple[int, datetime]] = {}


def _gc_states() -> None:
    import datetime as _dt
    cutoff = _dt.datetime.utcnow() - _dt.timedelta(minutes=10)
    for k in [k for k, (_, t) in _oauth_state.items() if t < cutoff]:
        _oauth_state.pop(k, None)


class GoogleStatus(BaseModel):
    connected: bool
    email: str | None = None


class GoogleAuthStart(BaseModel):
    consent_url: str


@router.get("/google/status", response_model=GoogleStatus)
async def google_status(
    current: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    user = await resolve_effective_user(current, db)
    return GoogleStatus(
        connected=bool(user.google_refresh_token_encrypted),
        email=user.google_email,
    )


@router.get("/google/oauth-start", response_model=GoogleAuthStart)
async def google_oauth_start(
    current: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the Google consent URL. Frontend redirects the window there
    (or opens a popup). The ``state`` parameter is how we identify the
    user in the callback — we store user_id → state mapping in memory."""
    from app.services.google_tasks import build_consent_url, new_state_token
    from datetime import datetime as _dt

    user = await resolve_effective_user(current, db)
    _gc_states()
    state = new_state_token()
    _oauth_state[state] = (user.id, _dt.utcnow())
    try:
        return GoogleAuthStart(consent_url=build_consent_url(state))
    except RuntimeError as e:
        raise HTTPException(500, str(e))


@router.get("/google/callback")
async def google_oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Endpoint Google redirects to after the user grants/denies consent.

    Returns a tiny HTML page that closes the popup (if it was opened as
    one) or redirects to /settings otherwise.
    """
    from fastapi.responses import HTMLResponse
    from app.services.google_tasks import exchange_code
    from app.utils.crypto import encrypt
    from datetime import datetime as _dt, timedelta as _td

    _gc_states()

    if error:
        return HTMLResponse(
            f"<html><body><h2>Échec OAuth : {error}</h2>"
            "<p><a href='/settings'>Retour aux paramètres</a></p></body></html>",
            status_code=400,
        )
    if not code or not state:
        raise HTTPException(400, "Paramètres manquants (code/state)")

    entry = _oauth_state.pop(state, None)
    if not entry:
        raise HTTPException(403, "state invalide ou expiré — relance depuis /settings")
    user_id, _issued = entry

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Utilisateur introuvable")

    try:
        toks = await exchange_code(code)
    except Exception as e:
        raise HTTPException(502, f"Échange de code Google échoué : {e}")

    if not toks.get("refresh_token"):
        # Happened when access_type or prompt was wrong in build_consent_url
        raise HTTPException(
            502,
            "Google n'a pas renvoyé de refresh_token. Va dans ton compte Google "
            "→ Sécurité → Accès par app tiers et supprime BatchChef, puis retente.",
        )

    user.google_email = toks["email"]
    user.google_refresh_token_encrypted = encrypt(toks["refresh_token"])
    user.google_access_token_encrypted = encrypt(toks["access_token"])
    user.google_access_token_expires_at = _dt.utcnow() + _td(seconds=toks["expires_in"])
    await db.commit()

    # Tiny auto-close page that falls through to /settings if opened full-window
    return HTMLResponse(
        "<html><head><title>Google Tasks connecté</title></head>"
        "<body style='font-family: sans-serif; text-align: center; padding: 50px;'>"
        "<h2>✅ Google Tasks connecté</h2>"
        f"<p>Compte : <code>{toks['email']}</code></p>"
        "<p>Tu peux refermer cet onglet.</p>"
        "<script>"
        "  setTimeout(() => {"
        "    if (window.opener) window.close();"
        "    else window.location.href = '/settings';"
        "  }, 800);"
        "</script></body></html>"
    )


@router.delete("/google/disconnect", status_code=204)
async def google_disconnect(
    current: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """Wipe Google tokens. Doesn't revoke them on Google's side — the user
    can revoke from https://myaccount.google.com/permissions if desired."""
    user = await resolve_effective_user(current, db)
    user.google_email = None
    user.google_refresh_token_encrypted = None
    user.google_access_token_encrypted = None
    user.google_access_token_expires_at = None
    await db.commit()
