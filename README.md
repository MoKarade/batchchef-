# BatchChef V2

Planificateur de batch cooking intelligent — scraping Marmiton, prix supermarché (Maxi), OCR tickets de caisse via Gemini Vision.

## Stack

| Composant | Technologie |
|---|---|
| Backend API | FastAPI (Python 3.13) + SQLAlchemy + SQLite |
| Workers | Celery + Redis |
| Scraping | Playwright (Python) |
| IA | Gemini 2.0 Flash (standardisation ingrédients, classification, OCR) |
| Frontend | Next.js 16 + shadcn/ui + Tailwind |
| Données | 43 492 URLs Marmiton (`data/cleaned_recipes.txt`) |

---

## Installation

### Prérequis
- Python 3.13
- Node.js 20+
- [uv](https://docs.astral.sh/uv/) (installer: `powershell -c "irm https://astral.sh/uv/install.ps1 | iex"`)
- Redis (via Docker: `docker run -d -p 6379:6379 redis:7-alpine`)

### Backend
```powershell
cd backend
copy .env.example .env   # puis éditer GEMINI_API_KEY
uv sync
uv run playwright install chromium
```

### Frontend
```powershell
cd frontend
npm install
```

---

## Démarrage

### Méthode 1 — Manuelle (3 terminaux)

**Terminal 1 — Backend FastAPI :**
```powershell
cd backend
uv run uvicorn app.main:app --reload --port 8000
```

**Terminal 2 — Celery Worker (pour l'import) :**
```powershell
cd backend
uv run celery -A app.workers.celery_app worker --loglevel=info --pool=solo
```

**Terminal 3 — Frontend Next.js :**
```powershell
cd frontend
npm run dev
```

Ouvrir **http://localhost:3000**

### Méthode 2 — Docker Compose
```bash
docker compose up --build
```

---

## Utilisation

### 1. Configurer la clé Gemini
Éditer `backend/.env` et ajouter votre clé :
```
GEMINI_API_KEY=AIza...
```

### 2. Importer les recettes Marmiton
1. Aller sur **http://localhost:3000/imports**
2. Optionnel : entrer une limite (ex: 100 pour tester)
3. Cliquer "Démarrer" — la barre de progression se met à jour en temps réel

### 3. Générer un batch
1. Aller sur **http://localhost:3000/batches/new**
2. Choisir le nombre de portions cibles (défaut: 20)
3. Cliquer "Générer le batch" — 3 recettes sont sélectionnées automatiquement

### 4. Scanner un ticket de caisse
1. Aller sur **http://localhost:3000/receipts**
2. Glisser-déposer une photo de ticket (Maxi, Costco, Fruiterie)
3. Gemini Vision extrait les articles — valider pour mettre à jour l'inventaire

---

## Structure du projet
```
batch-cooking/
├── backend/            # FastAPI + Celery workers
│   ├── app/
│   │   ├── main.py    # Entry point
│   │   ├── models/    # SQLAlchemy ORM
│   │   ├── routers/   # API endpoints
│   │   ├── services/  # Business logic
│   │   ├── scrapers/  # Playwright scrapers
│   │   ├── ai/        # Gemini integration
│   │   └── workers/   # Celery tasks
│   └── .env           # Configuration (ne pas committer)
├── frontend/           # Next.js 16 app
│   ├── app/           # App Router pages
│   ├── components/    # React components
│   └── lib/           # API client + utils
├── data/
│   └── cleaned_recipes.txt   # 43 492 URLs Marmiton
├── uploads/            # Tickets de caisse (gitignored)
└── .archive-node/      # Ancien code Node.js (référence)
```

---

## API

Documentation interactive : **http://localhost:8000/docs**

Endpoints principaux :
- `POST /api/imports/marmiton` — Lance l'import bulk
- `WS /ws/jobs/{job_id}` — Stream WebSocket de progression
- `GET /api/recipes` — Liste des recettes (pagination, search, filtres)
- `POST /api/batches/generate` — Génère un batch (3 recettes, N portions)
- `GET /api/inventory` — Stock actuel
- `POST /api/receipts` — Upload ticket de caisse (multipart)
