"""Construit le résumé BatchChef pour le hub perso (hubperso.com).

Conforme au contrat @mokarade/hub-contract v1 (GET .../hub/summary) : app + metrics
(≤6) + alerts (≤10) + actions (≤6) + status. Données RÉELLES agrégées depuis la base
(recettes, batchs, inventaire, tarification) — aucune donnée inventée : une base vide
donne status="building", jamais des chiffres factices. Fonction PURE (aucune auth, aucune
I/O réseau) : l'auth x-hub-token vit dans le routeur, ce module ne fait que lire la base.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.batch import Batch, ShoppingListItem
from app.models.ingredient import IngredientMaster
from app.models.inventory import InventoryItem
from app.models.job import ImportJob
from app.models.recipe import Recipe

CONTRACT_VERSION = 1
APP_COLOR = "#c2410c"  # orange « cuisine », validé par la regex hex du contrat
_ACTIVE_BATCH = ("draft", "shopping", "cooking")


def _iso_utc(dt: datetime | None) -> str | None:
    """ISO 8601 en UTC avec suffixe `Z` (le contrat refuse les offsets +hh:mm)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)  # SQLite stocke func.now() en UTC naïf
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


async def _scalar(db: AsyncSession, stmt) -> int | float:
    return (await db.execute(stmt)).scalar_one()


async def build_hub_summary(db: AsyncSession) -> dict:
    """Agrège l'état BatchChef en un HubSummary conforme au contrat (dict prêt à sérialiser)."""
    now = datetime.now(timezone.utc)
    # Seuil naïf-UTC : les colonnes DateTime sont stockées naïves (func.now() = UTC) en base ;
    # comparer avec un datetime aware fausserait le tri lexicographique SQLite (suffixe +00:00).
    stale_before = now.replace(tzinfo=None) - timedelta(days=settings.PRICE_STALE_DAYS)

    recipes_ready = await _scalar(db, select(func.count()).select_from(Recipe).where(Recipe.status == "ai_done"))
    active_batches = await _scalar(db, select(func.count()).select_from(Batch).where(Batch.status.in_(_ACTIVE_BATCH)))
    inventory_items = await _scalar(db, select(func.count()).select_from(InventoryItem))
    ingredients_total = await _scalar(db, select(func.count()).select_from(IngredientMaster))
    ingredients_mapped = await _scalar(
        db, select(func.count()).select_from(IngredientMaster).where(IngredientMaster.price_mapping_status == "mapped")
    )
    ingredients_unmapped = ingredients_total - ingredients_mapped
    stale_prices = await _scalar(
        db,
        select(func.count()).select_from(IngredientMaster).where(
            IngredientMaster.price_mapping_status == "mapped",
            IngredientMaster.last_price_mapping_at.isnot(None),
            IngredientMaster.last_price_mapping_at < stale_before,
        ),
    )
    # Coût des courses NON achetées, sur les batchs encore actifs (ce qu'il reste à dépenser).
    shopping_remaining = await _scalar(
        db,
        select(func.coalesce(func.sum(ShoppingListItem.estimated_cost), 0.0))
        .select_from(ShoppingListItem)
        .join(Batch, Batch.id == ShoppingListItem.batch_id)
        .where(
            Batch.status.in_(_ACTIVE_BATCH),
            ShoppingListItem.is_purchased.is_(False),
            ShoppingListItem.estimated_cost.isnot(None),
        ),
    )

    total_batches = await _scalar(db, select(func.count()).select_from(Batch))

    # --- Métriques (max 6, on n'affiche que ce qui a du sens) ---
    metrics: list[dict] = [
        {"label": "Recettes prêtes", "value": int(recipes_ready), "format": "number"},
        {"label": "Batchs actifs", "value": int(active_batches), "format": "number"},
        {"label": "Articles en inventaire", "value": int(inventory_items), "format": "number"},
        {
            "label": "Courses à acheter",
            "value": round(float(shopping_remaining), 2),
            "format": "currency",
        },
    ]
    if ingredients_total > 0:
        coverage = round(ingredients_mapped / ingredients_total * 100, 1)
        metrics.append({
            "label": "Ingrédients tarifés",
            "value": coverage,
            "format": "percent",
            "severity": "ok" if coverage >= 90 else "warn",
        })
    metrics.append({
        "label": "Prix périmés",
        "value": int(stale_prices),
        "format": "number",
        "severity": "warn" if stale_prices > 0 else "ok",
    })
    metrics = metrics[:6]

    # --- Alertes (max 10) : honnêtes, actionnables ---
    alerts: list[dict] = []
    failed_recent = await _scalar(
        db,
        select(func.count()).select_from(ImportJob).where(
            ImportJob.status == "failed",
            ImportJob.created_at.isnot(None),
        ),
    )
    running = (await db.execute(
        select(ImportJob).where(ImportJob.status == "running").order_by(ImportJob.created_at.desc()).limit(1)
    )).scalar_one_or_none()
    if running is not None:
        alerts.append({
            "label": f"Import en cours : {running.progress_current}/{running.progress_total}",
            "severity": "info",
        })
    if failed_recent > 0:
        alerts.append({"label": f"{failed_recent} import(s) en échec", "severity": "alert"})
    if stale_prices > 0:
        alerts.append({
            "label": f"{stale_prices} prix périmés (> {settings.PRICE_STALE_DAYS} j)",
            "severity": "warn",
        })
    if ingredients_unmapped > 0:
        alerts.append({"label": f"{ingredients_unmapped} ingrédients sans prix", "severity": "info"})
    alerts = alerts[:10]

    # --- Actions (max 6) : deep link vers l'UI (href absolu exigé par le contrat) ---
    actions: list[dict] = []
    base = settings.HUB_APP_URL.strip().rstrip("/")
    if base.startswith("http://") or base.startswith("https://"):
        actions.append({"label": "Ouvrir BatchChef", "kind": "link", "href": base})

    # --- Statut honnête ---
    if total_batches == 0 and recipes_ready == 0:
        status = "building"  # rien encore : jamais de faux chiffres
    elif failed_recent > 0:
        status = "degraded"
    else:
        status = "ok"

    data_as_of = _iso_utc(await _scalar_dt(db))

    summary: dict = {
        "contractVersion": CONTRACT_VERSION,
        "app": {
            "id": "batchchef",
            "name": "BatchChef",
            "url": base if base else "http://localhost:5173",
            "color": APP_COLOR,
        },
        "generatedAt": _iso_utc(now),
        "status": status,
        "metrics": metrics,
        "alerts": alerts,
        "actions": actions,
    }
    if data_as_of is not None:
        summary["dataAsOf"] = data_as_of
    return summary


async def _scalar_dt(db: AsyncSession) -> datetime | None:
    """Fraîcheur des données : le plus récent entre dernier batch et dernière tarification."""
    last_batch = (await db.execute(select(func.max(Batch.generated_at)))).scalar_one_or_none()
    last_price = (await db.execute(select(func.max(IngredientMaster.last_price_mapping_at)))).scalar_one_or_none()
    candidates = [d for d in (last_batch, last_price) if d is not None]
    return max(candidates) if candidates else None
