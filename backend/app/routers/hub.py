"""GET /api/hub/summary — résumé BatchChef pour le hub perso (hubperso.com).

Auth : header `x-hub-token` comparé en TEMPS CONSTANT au secret `HUB_TOKEN`. Échec fermé —
si `HUB_TOKEN` n'est pas configuré, la route renvoie 503 (jamais de données sans secret) ;
un jeton absent ou faux → 401. Réponse toujours `Cache-Control: no-store`. Les données sont
agrégées par `build_hub_summary` (module pur) ; une panne de base renvoie un summary
status="error" (HTTP 200) pour que le widget du hub montre l'erreur au lieu d'un vide trompeur.
"""
import hashlib
import hmac
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal
from app.services.hub_summary import APP_COLOR, CONTRACT_VERSION, build_hub_summary

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/hub", tags=["hub"])

_NO_STORE = {"Cache-Control": "no-store"}


def _tokens_match(provided: str, expected: str) -> bool:
    """Comparaison en temps constant, insensible à la longueur (digests SHA-256)."""
    a = hashlib.sha256(provided.encode()).digest()
    b = hashlib.sha256(expected.encode()).digest()
    return hmac.compare_digest(a, b)


def _error_summary(reason: str) -> dict:
    """Summary status="error" (données réelles indisponibles) — le hub affiche la panne."""
    return {
        "contractVersion": CONTRACT_VERSION,
        "app": {"id": "batchchef", "name": "BatchChef", "url": settings.HUB_APP_URL or "http://localhost:5173", "color": APP_COLOR},
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "status": "error",
        "metrics": [],
        "alerts": [{"label": f"Données indisponibles : {reason}"[:80], "severity": "alert"}],
        "actions": [],
    }


@router.get("/summary")
async def hub_summary(x_hub_token: str | None = Header(default=None)):
    if not settings.HUB_TOKEN:
        # Route désactivée tant qu'aucun secret n'est posé (fail-closed, comme FinanceAI/DriveAI).
        raise HTTPException(status_code=503, detail="HUB_TOKEN non configuré")
    if not x_hub_token or not _tokens_match(x_hub_token, settings.HUB_TOKEN):
        raise HTTPException(status_code=401, detail="x-hub-token absent ou invalide", headers=_NO_STORE)

    try:
        async with AsyncSessionLocal() as db:  # type: AsyncSession
            summary = await build_hub_summary(db)
        return JSONResponse(content=summary, headers=_NO_STORE)
    except Exception as exc:  # noqa: BLE001 — une panne de base ne doit jamais 500 en silence
        logger.exception("hub_summary: échec d'agrégation")
        return JSONResponse(content=_error_summary(str(exc)), headers=_NO_STORE)
