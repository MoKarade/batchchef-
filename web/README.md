# BatchChef web — la refonte (Phase 1)

Planificateur de batch cooking québécois, **100 % en ligne** : Next.js (Vercel) +
Neon Postgres + LLM. Zéro Celery/Redis/Playwright — voir la décision de refonte
(diagnostic du 2026-07-23) : les prix viendront des reçus (Phase 2) et des circulaires
(Phase 3), jamais du scraping anti-bot.

## Ce que fait la Phase 1

- **Bibliothèque de recettes** : colle l'URL d'une recette (n'importe quel site) → un
  LLM extrait titre, portions, ingrédients aux unités normalisées (g/ml/unité),
  instructions. Validation Zod stricte : un parse douteux est rejeté, jamais inséré sale.
- **Batchs** : choisis tes recettes + portions → liste d'épicerie agrégée
  (mise à l'échelle, regroupement par ingrédient, jamais deux unités mélangées).
- **Liste d'épicerie mobile** : plein écran téléphone, grosses cases, cochage optimiste
  qui tolère le réseau d'épicerie (échec → la case revient + bandeau).
- **Budget honnête** : coûts **estimés** par LLM, toujours marqués « estimé » (badge ≈) ;
  les prix réels arriveront des reçus en Phase 2. Aucune donnée inventée.
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

## Vérifications avant commit

```bash
npm run typecheck && npm run test && npm run build
```

## Suite (phases suivantes — cf. document de refonte)

- **Phase 2** : scan de reçus (photo → LLM) → prix RÉELS par ingrédient/magasin,
  inventaire vivant (solde par mouvements).
- **Phase 3** : spéciaux de la semaine (circulaires) + suggestions de batch.
- **Phase 4** : endpoint `/hub/summary` (widget hubperso.com) + PWA complète.
