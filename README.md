# BatchChef V3 — Pricing

> Planificateur de batch cooking québécois qui scrape Marmiton, mappe chaque
> ingrédient aux prix **Maxi / Costco / Fruiterie 440** (avec photos), détecte
> les prix périmés, et génère des listes de courses optimisées (TPS + TVQ).

V3 ajoute au socle V2 un **pipeline de prix complet** : images CDN Loblaws
HEAD-vérifiées, prix par unité adaptatif (kg / L / pièce), fallback
OpenFoodFacts, validation Gemini, et un import Marmiton continu qui tourne
jusqu'à épuisement des URLs.

## Stack

| Composant | Techno |
|---|---|
| Backend API | FastAPI (Python 3.14) + SQLAlchemy 2.0 async + SQLite |
| Workers | Celery + Redis (Windows : `--pool=solo`) |
| Scrapers | Playwright + patchright (Costco anti-bot) |
| AI | **Gemini 3 Flash Preview** (fallback 3.1 Flash Lite) |
| Frontend | Next.js 16 + Tailwind + TanStack Query |
| Données | `data/cleaned_recipes.txt` (43 492 URLs Marmiton) |

---

## Quickstart

```bash
# Backend
cd backend
cp .env.example .env             # fill GEMINI_API_KEY
uv sync
uv run playwright install chromium
uv run alembic upgrade head

# Frontend
cd ../frontend && npm install

# Redis (requis pour Celery)
# Windows:  redis-server.exe
# macOS:    brew services start redis
# Docker:   docker run -d -p 6379:6379 redis:7-alpine
```

### Lancer les services (3 terminaux)

```bash
# Terminal 1 — API
cd backend && uv run uvicorn app.main:app --reload --port 8001

# Terminal 2 — Celery (requis pour tout job)
cd backend && uv run celery -A app.workers.celery_app worker --loglevel=info --pool=solo

# Terminal 3 — Frontend
cd frontend && npm run dev       # http://localhost:3000
```

Ou via `preview_start` avec `.claude/launch.json` si tu utilises Claude Code.

---

## Config (`backend/.env`)

```env
# AI (Gemini primaire)
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-3-flash-preview
GEMINI_MODEL_FALLBACK=gemini-3.1-flash-lite-preview
GEMINI_MIN_INTERVAL_S=1.0         # paid tier: 0, free: 6

# DB + broker
DATABASE_URL=sqlite+aiosqlite:///./batchchef.db
REDIS_URL=redis://localhost:6379/0

# Scraping Québec
MAXI_STORE_ID=7234                # Fleur-de-Lys, Québec
MAXI_POSTAL_CODE=G1M 3E5
COSTCO_ENABLED=true
COSTCO_POSTAL_CODE=G2J 1E3
COSTCO_WAREHOUSE_NAME_HINT=Quebec
PLAYWRIGHT_HEADLESS=false         # Costco exige headful
SCRAPE_CONCURRENCY=5
PRICE_STALE_DAYS=14
```

**⚠ Gotcha Windows** : `.env` doit être **UTF-8 sans BOM, LF**. Si une
variable système `ANTHROPIC_API_KEY=""` existe, `config.py` backfill
automatiquement depuis `.env` (sinon pydantic-settings priorise `os.environ`).

---

## Docs détaillées

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — modèles de données,
  flux `import → standardize → price → batch`, WebSocket, migrations
- **[docs/PRICING_PIPELINE.md](docs/PRICING_PIPELINE.md)** — scrapers Maxi /
  Costco / Fruiterie, CDN Loblaws HEAD-vérifié, fallback OpenFoodFacts,
  validation Gemini, règle « mapped = photo + prix + lien »
- **[docs/JOBS.md](docs/JOBS.md)** — catalogue Celery (import marmiton,
  map-prices, classify-ingredients, continuous import, zombie cleanup…)
- **[docs/API.md](docs/API.md)** — tous les endpoints REST
- **[docs/FRONTEND.md](docs/FRONTEND.md)** — ⚠ **Next.js 16 a des breaking
  changes** (voir `frontend/AGENTS.md`)
- **[docs/OPERATIONS.md](docs/OPERATIONS.md)** — runbook : backfill complet,
  relance après crash, monitoring, ETA

---

## Auth

**Désactivée** en V3 (mode local / single-user). `frontend/lib/auth.tsx`
retourne un stub admin. Les routes `/login` et `/register` redirigent
vers `/`. Pour réactiver : voir `docs/ARCHITECTURE.md § "Re-enabling auth"`.

---

## Utilisation rapide

1. **Importer** les recettes : `POST /api/imports/marmiton` (ou
   `/api/imports/marmiton/continuous` pour scraper **toutes** les URLs
   jusqu'à épuisement)
2. **Mapper les prix** : `POST /api/stores/map-prices` (tous les pending) ou
   avec `{"ingredient_ids":[…]}` pour un sous-ensemble
3. **Classifier** : `POST /api/ingredients/classify` nettoie les noms
   corrompus + assigne 10 catégories via Gemini
4. **Générer un batch** : `POST /api/batches/preview` → `POST /api/batches/accept`

---

## Problèmes connus

Voir `docs/OPERATIONS.md § Troubleshooting` :
- Costco warm-up bloqué par OneTrust → prix rarement trouvés
- Gemini JSON tronqué → fallback automatique sur canonical_name
- Images 403 / 404 → HEAD-check avant persist (V3)

---

## Contribuer

- Format : `uv run ruff check backend/` + `cd frontend && npm run lint`
- Tests : `uv run pytest backend/tests/` (smoke only, WIP)
- Commits : conventional, co-authored by `Claude Sonnet 4.6`
