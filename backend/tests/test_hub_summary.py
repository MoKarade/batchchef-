"""Tests du résumé hub BatchChef : agrégation réelle, statut honnête, auth temps constant.

Couvre : base vide → status="building" (jamais de faux chiffres) ; base peuplée → status="ok"
avec les bons compteurs + alerte prix périmés + couverture de tarification ; job échoué →
status="degraded" ; conformité au contrat (≤6 metrics, ≤10 alerts, formats/status valides,
generatedAt en UTC-Z) ; comparaison de jeton en temps constant ; route 503/401 fail-closed.
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.config import settings
from app.models.batch import Batch, ShoppingListItem
from app.models.ingredient import IngredientMaster
from app.models.inventory import InventoryItem
from app.models.job import ImportJob
from app.models.recipe import Recipe
from app.routers.hub import _tokens_match, hub_summary
from app.services.hub_summary import build_hub_summary

_VALID_FORMATS = {"currency", "percent", "number", "text"}
_VALID_STATUS = {"ok", "degraded", "error", "building"}


def _assert_contract_shape(s: dict):
    assert s["contractVersion"] == 1
    assert s["status"] in _VALID_STATUS
    assert len(s["metrics"]) <= 6
    assert len(s["alerts"]) <= 10
    assert len(s["actions"]) <= 6
    assert all(m["format"] in _VALID_FORMATS for m in s["metrics"])
    assert s["generatedAt"].endswith("Z")  # UTC-only exigé par le contrat
    assert s["app"]["id"] == "batchchef"
    assert s["app"]["color"].startswith("#") and len(s["app"]["color"]) == 7


async def test_base_vide_donne_building(db):
    s = await build_hub_summary(db)
    _assert_contract_shape(s)
    assert s["status"] == "building"  # rien en base → jamais de faux chiffres
    # Les métriques existent mais à zéro (honnête, pas d'invention).
    par_label = {m["label"]: m["value"] for m in s["metrics"]}
    assert par_label["Recettes prêtes"] == 0
    assert par_label["Batchs actifs"] == 0


async def _seed(db):
    naive_now = datetime.now(timezone.utc).replace(tzinfo=None)
    # 2 recettes prêtes, 1 encore en traitement (ne doit PAS compter).
    db.add_all([
        Recipe(marmiton_url="https://m/1", title="Curry", status="ai_done"),
        Recipe(marmiton_url="https://m/2", title="Salade", status="ai_done"),
        Recipe(marmiton_url="https://m/3", title="Brouillon", status="scraped"),
    ])
    # 3 ingrédients : 1 tarifé récent, 1 tarifé PÉRIMÉ (>14 j), 1 non tarifé.
    db.add_all([
        IngredientMaster(canonical_name="riz", display_name_fr="Riz",
                         price_mapping_status="mapped", last_price_mapping_at=naive_now),
        IngredientMaster(canonical_name="oeuf", display_name_fr="Œuf",
                         price_mapping_status="mapped",
                         last_price_mapping_at=naive_now - timedelta(days=30)),
        IngredientMaster(canonical_name="safran", display_name_fr="Safran",
                         price_mapping_status="pending"),
    ])
    db.add(InventoryItem(ingredient_master_id=1, quantity=500, unit="g"))
    b = Batch(name="Semaine 1", status="draft", generated_at=naive_now)
    db.add(b)
    await db.flush()
    # 2 articles de courses non achetés (12.50 $) + 1 déjà acheté (ignoré).
    db.add_all([
        ShoppingListItem(batch_id=b.id, ingredient_master_id=1, quantity_needed=1, unit="kg",
                         estimated_cost=7.50, is_purchased=False),
        ShoppingListItem(batch_id=b.id, ingredient_master_id=2, quantity_needed=1, unit="dz",
                         estimated_cost=5.00, is_purchased=False),
        ShoppingListItem(batch_id=b.id, ingredient_master_id=1, quantity_needed=1, unit="kg",
                         estimated_cost=99.0, is_purchased=True),
    ])
    await db.commit()


async def test_base_peuplee_agrege_le_reel(db):
    await _seed(db)
    s = await build_hub_summary(db)
    _assert_contract_shape(s)
    assert s["status"] == "ok"

    m = {x["label"]: x["value"] for x in s["metrics"]}
    assert m["Recettes prêtes"] == 2          # les "ai_done" seulement
    assert m["Batchs actifs"] == 1
    assert m["Articles en inventaire"] == 1
    assert m["Courses à acheter"] == 12.5     # 7.50 + 5.00, l'acheté (99) exclu
    assert m["Ingrédients tarifés"] == round(2 / 3 * 100, 1)  # 2 "mapped" (récent + périmé) sur 3
    assert m["Prix périmés"] == 1

    labels = " | ".join(a["label"] for a in s["alerts"])
    assert "prix périmés" in labels
    assert "ingrédients sans prix" in labels
    assert "dataAsOf" in s and s["dataAsOf"].endswith("Z")


async def test_job_echoue_degrade_le_statut(db):
    await _seed(db)
    db.add(ImportJob(job_type="marmiton_bulk", status="failed"))
    await db.commit()
    s = await build_hub_summary(db)
    assert s["status"] == "degraded"
    assert any(a["severity"] == "alert" for a in s["alerts"])


def test_tokens_match_temps_constant():
    assert _tokens_match("secret-partage", "secret-partage") is True
    assert _tokens_match("mauvais", "secret-partage") is False
    assert _tokens_match("", "secret-partage") is False
    assert _tokens_match("court", "beaucoup-plus-long") is False  # longueurs différentes OK


async def test_route_fail_closed_sans_secret(monkeypatch):
    monkeypatch.setattr(settings, "HUB_TOKEN", "")
    with pytest.raises(HTTPException) as e:
        await hub_summary(x_hub_token="peu-importe")
    assert e.value.status_code == 503  # jamais de données sans secret configuré


async def test_route_401_jeton_invalide(monkeypatch):
    monkeypatch.setattr(settings, "HUB_TOKEN", "le-bon-secret")
    with pytest.raises(HTTPException) as e:
        await hub_summary(x_hub_token="le-mauvais")
    assert e.value.status_code == 401
    with pytest.raises(HTTPException) as e2:
        await hub_summary(x_hub_token=None)
    assert e2.value.status_code == 401
