# BatchChef web

Planificateur de batch cooking québécois, **100 % en ligne** : Next.js (Vercel) +
Neon Postgres + LLM. Zéro Celery/Redis/Playwright, zéro scraping anti-bot. Les prix
d'épicerie sont **estimés** (LLM + filet déterministe, couverture 100 %) — jamais de
scan de reçus ni de prix « réels » relevés.

## Ce que fait la Phase 1

- **Bibliothèque de recettes** : colle l'URL d'une recette (n'importe quel site) → un
  LLM extrait titre, portions, ingrédients aux unités normalisées (g/ml/unité),
  instructions. Validation Zod stricte : un parse douteux est rejeté, jamais inséré sale.
- **Batchs** : choisis tes recettes + portions → liste d'épicerie agrégée
  (mise à l'échelle, regroupement par ingrédient, jamais deux unités mélangées).
- **Liste d'épicerie mobile** : plein écran téléphone, grosses cases, cochage optimiste
  qui tolère le réseau d'épicerie (échec → la case revient + bandeau).
- **Budget** : chaque article reçoit un coût **estimé** (LLM à Québec en CAD, taxes
  exclues) ; un filet déterministe garantit qu'aucun article ne reste sans prix
  (couverture 100 %). Ce sont des estimations, pas des prix relevés.
- **Privé** : login Google mono-adresse (pattern du hub perso), middleware fail-closed.

## Démarrage

```bash
cd web
npm install
cp .env.example .env.local   # puis remplis les valeurs (voir ci-dessous)
npm run db:migrate           # applique drizzle/ sur la base Neon
npm run dev
```

### Configuration (une fois)

1. **Neon** (base Postgres gratuite) : https://neon.tech → nouveau projet →
   copie la *connection string* (pooled) dans `DATABASE_URL`.
2. **Google OAuth** : Google Cloud Console → ton client OAuth « Web application »
   (le même projet que le hub fait l'affaire) → ajoute les redirect URIs listés dans
   `.env.example` → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
3. `AUTH_SECRET` : `npx auth secret`. `AUTHORIZED_EMAIL` : ton adresse.
4. **Anthropic** : `ANTHROPIC_API_KEY` (parse des recettes + estimations).

### Déploiement Vercel

Nouveau projet Vercel → ce repo → **Root Directory = `web`** → colle les variables
d'env ci-dessus → Deploy. C'est tout (pas de worker, pas de base à héberger toi-même).

**Migrations automatiques** : le script `vercel-build` (que Vercel utilise à la place de
`build` s'il est présent) lance `db:migrate` avant `next build`, à CHAQUE déploiement
(prod et previews). Rien à lancer à la main sur ta machine après un changement de schéma —
`git push` suffit. Idempotent : une migration déjà appliquée est ignorée (table de suivi
Drizzle), donc plusieurs déploiements qui se chevauchent ne rejouent rien deux fois.

## Catalogue de découverte (les 10 188 recettes de la V3)

Un écran `/catalogue` cherchable, séparé de ta bibliothèque perso : tu y piges des idées
et tu ajoutes ce qui t'intéresse (une ou plusieurs d'un coup). Peuplé une fois depuis la
base seed committée (`web/data/batchchef.seed.db`), unités normalisées à l'import :

```bash
cd web
DATABASE_URL='TON_URL_NEON' npm run db:migrate      # applique aussi la table catalogue (0001)
DATABASE_URL='TON_URL_NEON' npm run catalog:import   # importe les 10 188 recettes (~1-2 min)
```

Relançable sans risque (vide d'abord le catalogue). Ne touche jamais ta bibliothèque ni tes batchs.

## Vérifications avant commit

```bash
npm run typecheck && npm run test && npm run build
```

## Intégration hub

Endpoint `GET /api/hub/summary` (gardé par jeton `x-hub-token`) : le hub perso
(hubperso) affiche un widget BatchChef (recettes, batchs actifs, articles à acheter,
budget). Voir `lib/hubSummary.ts`.
