# HANDOFF — Pipeline prix (L1-L10)

_Dernière mise à jour : 2026-04-22. Session Claude : `9f3b735a-4956-4fc6-98bc-360750966438`._

> **Lire d'abord** : `CLAUDE.md` (conventions projet), `HANDOFF.md` (état refonte batch preview), puis ce fichier pour la pipeline prix spécifiquement.

---

## 1. Où en est-on

Plan complet dans `.claude/plans/on-va-se-concentrer-reactive-crown.md` (10 livrables L1-L10).

| # | Livrable | État |
|---|---|---|
| **L1** | Magasins Québec corrects (Maxi Fleur-de-Lys + Costco Bouvier) | 🟡 Costco DONE, Maxi en cours |
| L2 | Routing produce → Fruiterie, non-produce → Maxi/Costco | ⏳ |
| L3 | Fraîcheur prix (stale > 14j) + badges + barre Dashboard | ⏳ |
| L4 | Choix Maxi / Costco / Mixte dans batch preview | ⏳ |
| L5 | Refresh prix à la demande (recette / batch / panier) | ⏳ |
| L6 | Taxes TPS/TVQ + flag `is_taxable` | ⏳ |
| L7 | Coût par portion par recette | ⏳ |
| L8 | Job backfill global (~15 k ingrédients, ~13 h) | ⏳ |
| L9 | Annuler / supprimer imports + nettoyage zombies | ⏳ |
| L10 | Script de preuve end-to-end | ⏳ |

---

## 2. Ce qui a été livré cette session (L1 — Costco)

### 2.1 Code modifié

**`backend/app/config.py`** — nouvelles settings :
```python
MAXI_POSTAL_CODE: str = "G1M 3E5"          # Fleur-de-Lys, Québec
COSTCO_POSTAL_CODE: str = "G2J 1E3"        # 440 Rue Bouvier, Québec
COSTCO_WAREHOUSE_NAME_HINT: str = "Quebec" # Costco nomme l'entrepôt "Quebec"
PRICE_STALE_DAYS: int = 14
```

**`backend/app/scrapers/costco.py`** — ajout de :
- `_already_on_target_warehouse(context)` — lit le cookie JSON `STORELOCATION`, extrait `zip`, compare à `settings.COSTCO_POSTAL_CODE`. Rend `_select_warehouse` idempotent.
- `_select_warehouse(page)` — flow 4 étapes :
  1. Clique `[data-testid="Button_locationselector_WarehouseSelector--submit"]` (fallback texte si absent).
  2. Attend `[data-testid="WarehouseDrawer"]`, tape le postal dans `input[name="City, Province, or Postal Code"]`, clique `[data-testid="Button_warehousedrawer-submit"]`.
  3. Attend que la liste de résultats affiche un warehouse Québec-region (`Quebec`, `Sainte Foy`, `Levis`).
  4. Parcourt tous les `a[data-testid="Link"]`, **exact match d'abord** puis substring, remonte au tile pour cliquer `[data-testid="Button_warehousetile-setwarehouse-as-preferred"]`.
- Appelé depuis `_warm_up(page)` après `try_accept_cookies`.

### 2.2 Découvertes critiques

- **Akamai bypass** : `patchright` + `channel="chrome"` + **headful** + warmup homepage (déjà en place avant cette session).
- **Cookie warehouse** = `STORELOCATION` (JSON urlencoded), **PAS** `invCheckWhsId` / `invCheckPostalCode` (ceux-là sont seedés par IP-geo et ne bougent jamais via le drawer).
- **Tile Costco pinné index 0** = warehouse actuellement préféré (Anjou pour IP Montréal) → ne JAMAIS cliquer le premier bouton aveuglément.
- **`"Quebec"` est substring de `"Quebec City Business Centre"`** → exact match d'abord, substring fallback ensuite, sinon on pointe sur le Business Centre par erreur.
- Warehouse catalog ID 503 = Quebec (vu dans cookie `WAREHOUSEDELIVERY_WHS`).

### 2.3 Scripts de découverte (dans `backend/scripts/`)

Gardés pour diagnostic si Costco change son DOM :
- `find_costco_trigger.py` — trouve le trigger d'ouverture du drawer.
- `inspect_costco_popover.py` — inspecte input + listbox.
- `inspect_costco_results.py` — liste les warehouses retournés pour un postal donné.
- `trace_costco_postal.py` — trace le flow autocomplete.
- `trace_after_click.py` — trace les cookies après clic "Set as My Warehouse" (**c'est ce script qui a révélé `STORELOCATION`**).
- `test_costco_warehouse.py` — E2E : `_select_warehouse()` → True.
- `test_costco_search.py` — E2E : recherche produits. Confirme prix Quebec (olive oil $17.99, chicken breast $25.99, milk $12.99).

---

## 3. Où s'est-on arrêté (L1 — Maxi, à reprendre)

### Objectif

Remplacer `MAXI_STORE_ID=8676` (Toronto) dans `backend/.env` par le storeId de **Maxi Fleur-de-Lys** (550 Rue Fleur-de-Lys, Québec, G1M 3E5).

### Ce qui a été tenté

1. **Script UI Playwright** (`scripts/inspect_maxi_store.py`) — clique `[data-testid="iceberg-fulfillment-trigger"]` puis tape le postal. Résultat : ouvre un dialogue de confirmation `Oui / Non, modifier le magasin`. Flow complexe.
2. **API publique BFF** (`scripts/find_maxi_store_api.py`, créé en dernier) :
   ```python
   URL = "https://api.pcexpress.ca/pcx-bff/api/v1/pickup-locations?bannerIds=maxi"
   ```
   **→ HTTP 401 Unauthorized** sans token BFF. Abandon.

### Pistes pour reprendre

**Option A — Finir le flow UI (recommandé)**

Compléter `inspect_maxi_store.py` :
1. Après `page.click('[data-testid="iceberg-fulfillment-trigger"]')`, taper `G1M 3E5`.
2. Attendre suggestions → cliquer la première.
3. Cliquer `Oui, modifier le magasin` dans le dialogue confirm.
4. **Intercepter les XHR** qui suivent (`page.on("response", ...)` déjà en place dans le script) — le `storeId` apparaît soit dans l'URL, soit dans le body JSON, soit dans le cookie `auto_store_selected`.
5. Imprimer le storeId + adresse → coller dans `backend/.env`.

**Option B — Trouver le token BFF**

Dans `inspect_maxi_store.py`, logger les `request.headers['authorization']` pour trouver le bearer token anonyme utilisé par pcexpress.ca. Puis utiliser ce token dans `find_maxi_store_api.py`. Fragile (token peut tourner).

**Option C — Fouiller les cookies après sélection UI**

Observer dans `inspect_maxi_store.py` si un cookie `auto_store_selected=XXXX` apparaît après la sélection (la session précédente a vu `auto_store_selected=7234` = Montréal par défaut). Ça donnerait le storeId direct.

### Test de validation L1-Maxi

Après avoir trouvé le storeId :
1. `backend/.env` : `MAXI_STORE_ID=<nouveau>`.
2. `uv run python scripts/test_maxi_search.py` (à créer sur le modèle de `test_costco_search.py`) — recherche `olive oil`, vérifier que le prix est cohérent Québec et que le nom de magasin dans la réponse contient "Fleur-de-Lys".
3. Marquer L1 complet dans todos, enchaîner L2.

---

## 4. Plan détaillé L2-L10

**Source de vérité** : `.claude/plans/on-va-se-concentrer-reactive-crown.md` — tout y est (fichiers à toucher, schémas, flows UI, formule taxes TPS/TVQ, script de preuve). Le plan fait 400+ lignes, ne pas le recopier ici.

Résumé minimal pour chaque livrable :

- **L2** — `backend/app/workers/import_marmiton.py::_price_new_ingredients` split les ids par `is_produce` ; `backend/app/workers/estimate_fruiterie_prices.py::_fetch_targets` filtre `is_produce=True`.
- **L3** — `config.py::PRICE_STALE_DAYS=14`, enrichir `/api/ingredients/price-coverage` (fresh/stale/missing), badge Ingredients page, carte Dashboard.
- **L4** — `BatchPreviewIn.preferred_stores: list[str] | None`, `BatchPreviewOut.totals_by_mode`, toggle 3 modes dans `BatchPreviewStep.tsx`.
- **L5** — `POST /api/ingredients/refresh-prices`, hooks auto sur GET recipe / add to batch / add shopping item, WS job status. Debounce 10 min.
- **L6** — `config.py::TAX_GST=0.05`, `TAX_QST=0.09975`, nouveau champ `IngredientMaster.is_taxable` (+ migration), pose auto (produce = non-taxable) + Claude classifier.
- **L7** — `services/recipe_pricing.py::compute_cost_per_portion`, `RecipeOut.cost_per_portion`, chip UI sur RecipeCard + RecipeDetail.
- **L8** — Job Celery `prices.full_backfill`, bouton Settings / Outils avancés / confirm modal, progress WS. ~13 h nocturne.
- **L9** — `DELETE /api/imports/{job_id}` avec cascade, cleanup Celery beat quotidien zombies > 2 h, boutons Cancel / Delete dans ImportPage.
- **L10** — `scripts/demo_pricing_end_to_end.py` : import 2 recettes test, assert couverture + fraîcheur + totaux 3 modes.

---

## 5. Gotchas permanents (à savoir avant de toucher au code)

| Gotcha | Détail | Source |
|---|---|---|
| **Costco nécessite headful** | Homepage Costco bloque Chromium headless. `test_costco_*.py` et `map_prices.py` lancent le browser avec `headless=False`. | `backend/app/scrapers/costco.py:8-10` |
| **Akamai warm-up obligatoire** | Navigation directe `/s?keyword=X` → `HTTP2_PROTOCOL_ERROR`. Toujours passer par `_warm_up()` d'abord. | `backend/app/scrapers/costco.py::_warm_up` |
| **Encoding Windows cp1252** | Scripts qui impriment des arrows Unicode crashent. Utiliser `->`, `...`, ou `os.environ["PYTHONIOENCODING"] = "utf-8"`. | Vu plusieurs fois en session |
| **Celery `--pool=solo` sur Windows** | Pas de fork. `task_acks_late=True`, `prefetch=1` pour imports larges. | `backend/app/workers/celery_app.py` |
| **Ingredients utilisent underscores** | `huile_olive`, `poivre_noir` — convention Gemini standardizer. | `CLAUDE.md` |
| **Next.js 16 breaking changes** | Avant d'éditer le frontend, lire `node_modules/next/dist/docs/`. | `CLAUDE.md` |
| **Gemini + Claude free tier throttle** | 5 RPM client Claude branché (plan précédent #3 livré). | Livré avant cette session |
| **Fruiterie estime TOUT aujourd'hui** | Y compris viande → à corriger en L2. | `backend/app/workers/estimate_fruiterie_prices.py` |
| **`is_produce` existe mais pas utilisé pour router** | Classifier Claude le pose déjà, juste pas branché au routing. | `backend/app/models/ingredient.py` |
| **`cancel_requested` sur ImportJob** | Flag existe, à vérifier que `_run()` le respecte à chaque chunk (L9). | `backend/app/workers/import_marmiton.py` |

---

## 6. Environnement dev

### Setup sur nouvelle machine (si besoin)
```bash
git clone <repo>
cd batch-cooking
# backend
cd backend && cp .env.example .env   # remplir GEMINI_API_KEY, MAXI_STORE_ID, COSTCO_POSTAL_CODE
uv sync
uv run playwright install chromium
# frontend
cd ../frontend && npm install
```

### Lancer (3 terminaux)
```bash
# T1 — API
cd backend && uv run uvicorn app.main:app --reload --port 8000
# T2 — Worker (obligatoire pour imports/pricing)
cd backend && uv run celery -A app.workers.celery_app worker --loglevel=info --pool=solo
# T3 — Frontend
cd frontend && npm run dev
```

### Tests
```bash
cd backend && uv run pytest tests/
cd frontend && npm run build   # vérifie TypeScript
```

---

## 7. Mémoire persistante Claude

Index dans `C:\Users\dessin14\.claude\projects\C--Users-dessin14\memory\MEMORY.md` :
- `project_batchchef_setup.md` — comment cloner/lancer sur autre PC.
- `project_batchchef_stores.md` — Maxi Fleur-de-Lys + Costco Bouvier à toujours cibler.

Toute nouvelle session Claude Code dans `C:\Users\dessin14` lit ces mémoires automatiquement.

---

## 8. Pour reprendre (prochaine session)

```bash
cd C:\Users\dessin14\CascadeProjects\batch-cooking
claude --resume   # sélectionner 9f3b735a-... (pricing pipeline)
```

Puis dire : **« Reprends L1 côté Maxi. Flow UI Playwright : clique MON MAGASIN, entre G1M 3E5, clique Oui pour confirmer le changement, intercepte la XHR pour capturer le storeId. »**

Ou pour repartir à froid : **« Lis `HANDOFF_PRICING_PIPELINE.md` et continue au §3. »**

---

## 9. Historique de session (archives)

Fichiers JSONL (une ligne = un message, lisibles avec `jq` ou éditeur texte) :
```
C:\Users\dessin14\.claude\projects\C--Users-dessin14\
  9f3b735a-...jsonl   ← cette session (pricing pipeline, ~5 MB)
  d4057d82-...jsonl   ← session précédente (plans antérieurs, ~8 MB)
  32ad05df-...jsonl   ← session initiale
```

Plans archivés dans `.claude/plans/` (Claude Code les conserve automatiquement).
