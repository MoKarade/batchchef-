"""Google Tasks API client + OAuth flow.

Why no SDK: ``google-api-python-client`` pulls 20+ transitive deps and an
async wrapper that fights with our asyncio event loop. The Google Tasks
REST surface we need (create list + create tasks) is 3 endpoints — we can
hit them with httpx directly.

Token lifecycle:
  - User clicks "Connect Google" → GET /api/auth/google/oauth-start
  - Backend returns the Google consent URL with a one-time ``state`` token.
  - User grants → Google redirects to /api/auth/google/callback?code=...
  - We exchange the code for (access_token, refresh_token, expires_in)
    and persist them Fernet-encrypted on the User row.
  - Each subsequent Tasks call auto-refreshes the access_token if expired.

Scopes requested (minimum needed):
  - ``openid email`` — so we know which Google account is linked (shown in UI).
  - ``https://www.googleapis.com/auth/tasks`` — write access to Tasks.
"""
from __future__ import annotations
import logging
import secrets
from datetime import datetime, timedelta
from urllib.parse import urlencode

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

OAUTH_SCOPES = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/tasks",
]

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
TASKS_API_BASE = "https://tasks.googleapis.com/tasks/v1"


def build_consent_url(state: str) -> str:
    """Return the URL to redirect the user to for Google's consent screen.

    ``state`` is a random token we verify in the callback to prevent CSRF."""
    if not settings.GOOGLE_OAUTH_CLIENT_ID:
        raise RuntimeError(
            "GOOGLE_OAUTH_CLIENT_ID not configured in .env. "
            "Create OAuth credentials at https://console.cloud.google.com/apis/credentials "
            "and enable the Google Tasks API."
        )
    params = {
        "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_OAUTH_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(OAUTH_SCOPES),
        # ``access_type=offline`` + ``prompt=consent`` guarantees we get a
        # refresh_token on the first grant AND on subsequent re-consents
        # (without prompt=consent Google silently skips refresh_token
        # reissuance, which means if the user disconnects + reconnects
        # we'd lose offline access).
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
        "include_granted_scopes": "true",
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


def new_state_token() -> str:
    """32-byte URL-safe random token for CSRF protection on the callback."""
    return secrets.token_urlsafe(32)


async def exchange_code(code: str) -> dict:
    """Swap an auth code for access/refresh tokens + expiry. Also fetches
    the userinfo so we know which Google email is connecting."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        tok_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
                "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
                "redirect_uri": settings.GOOGLE_OAUTH_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        )
        tok_resp.raise_for_status()
        tok = tok_resp.json()

        # Query userinfo to record which email linked up
        user_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {tok['access_token']}"},
        )
        user_resp.raise_for_status()
        user = user_resp.json()

    return {
        "access_token": tok["access_token"],
        "refresh_token": tok.get("refresh_token"),  # None on re-grant without prompt=consent
        "expires_in": int(tok.get("expires_in", 3600)),
        "email": user.get("email"),
    }


async def refresh_access_token(refresh_token: str) -> tuple[str, int]:
    """Return (new_access_token, expires_in_seconds) for a valid refresh_token."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "refresh_token": refresh_token,
                "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
                "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
                "grant_type": "refresh_token",
            },
        )
        r.raise_for_status()
        j = r.json()
    return j["access_token"], int(j.get("expires_in", 3600))


async def ensure_access_token(user, db) -> str:
    """Return a valid access token for the user, refreshing if expired.

    Imports are local to avoid a circular import (user model <-> service).
    """
    from app.utils.crypto import decrypt, encrypt

    if not user.google_refresh_token_encrypted:
        raise RuntimeError("Utilisateur non connecté à Google Tasks")

    # Fresh token cached?
    now = datetime.utcnow()
    if (
        user.google_access_token_encrypted
        and user.google_access_token_expires_at
        and user.google_access_token_expires_at > now + timedelta(seconds=60)
    ):
        return decrypt(user.google_access_token_encrypted)

    # Refresh
    refresh = decrypt(user.google_refresh_token_encrypted)
    access, expires_in = await refresh_access_token(refresh)
    user.google_access_token_encrypted = encrypt(access)
    user.google_access_token_expires_at = now + timedelta(seconds=expires_in)
    await db.commit()
    return access


async def create_tasklist(access_token: str, title: str) -> str:
    """Create a new Tasks list and return its id."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(
            f"{TASKS_API_BASE}/users/@me/lists",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json={"title": title},
        )
        r.raise_for_status()
        return r.json()["id"]


async def create_task(
    access_token: str, tasklist_id: str, title: str, notes: str | None = None
) -> str:
    """Append a task to a list. Returns the new task id.

    Google Tasks only supports plain-text notes (no HTML / markdown), so we
    pack product URLs into the notes field with a leading newline — the
    Tasks UI auto-linkifies bare URLs.
    """
    body = {"title": title}
    if notes:
        body["notes"] = notes
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(
            f"{TASKS_API_BASE}/lists/{tasklist_id}/tasks",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json=body,
        )
        r.raise_for_status()
        return r.json()["id"]
