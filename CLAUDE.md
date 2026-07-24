# CLAUDE.md — BatchChef

Planificateur de batch cooking québécois, **100 % en ligne**. Toute l'app vit dans `web/`.

## Stack

- **Next.js 15** (App Router, Server Components + Server Actions), **Vercel**.
- **Drizzle ORM** + **Neon** (Postgres serverless).
- **Auth.js v5** (Google, mono-adresse `AUTHORIZED_EMAIL`, middleware fail-closed).
- **LLM** (`@anthropic-ai/sdk`) pour le parse de recettes et l'estimation des prix.
- **Tailwind v4**, **Zod**, **vitest**.

## Principes non négociables

- **No fake data.** Un parse douteux est rejeté (Zod), jamais inséré sale. Les prix sont
  des **estimations** (LLM + filet déterministe, couverture 100 %) — jamais présentés comme
  des prix relevés. Pas de scraping, pas de reçus.
- **Server-side only.** Fetch, jetons et écritures restent côté serveur ; chaque Server
  Action revérifie la session (`requireSession`).
- **Unités normalisées** au parse (`lib/units.ts` → g/ml/unite ou null « au goût »).
- **Fonctions pures testées** pour la logique (agrégation, mise à l'échelle, prix, jetons).

## Structure `web/`

| Chemin | Rôle |
|---|---|
| `app/` | routes (recettes, batchs, courses, catalogue, `/api/hub/summary`) |
| `lib/actions.ts` | Server Actions (import, batch, liste, statut, catalogue) |
| `lib/aggregate.ts` | agrégation liste d'épicerie, mise à l'échelle, filet de prix (purs) |
| `lib/llm/` | parse de recette + estimation de coûts (Zod, honnête) |
| `lib/db/` | schéma Drizzle + connexion Neon paresseuse |
| `lib/hubSummary.ts` | résumé conforme `@mokarade/hub-contract` (widget hub perso) |
| `data/batchchef.seed.db` | base seed du catalogue (10 188 recettes) |

## Vérifications avant commit

```bash
cd web && npm run typecheck && npm run test && npm run build
```

## Style (hérité du CLAUDE.md global de Marc)

- Réponses, commits et docs **en français** (`feat:`, `fix:`, `docs:`…).
- TypeScript strict, pas de `any` silencieux. Erreurs honnêtes, jamais avalées.
- Pas d'emoji dans l'UI ni les docs (sauf demande explicite).
