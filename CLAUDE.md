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
- **Planchers de version, jamais redescendus.** `drizzle-orm ≥ 0.45.2` (injection SQL par
  identifiants mal échappés, GHSA-gpj5-g38j-94v9, HIGH), et les `overrides` de `postcss` et
  `sharp` qui ferment des failles que Next épingle lui-même. *Verrou* :
  `web/tests/dependances.test.ts` — il inspecte **toutes** les copies du lockfile, pas
  seulement la racine (Next embarquait sa propre `postcss` 8.4.31 dans son `node_modules`,
  vulnérable et invisible depuis le premier niveau). Discrimination prouvée. Retirer un
  `override` seulement après avoir mesuré `npm audit --omit=dev` → 0.

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

Et, après toute modification de dépendances : `npm audit --omit=dev` doit rendre **0**.
Les quelques avis `moderate` restants sont **dev-only** (chaîne `esbuild` → `drizzle-kit`,
serveur de développement) : ils ne touchent pas la production et `npm audit fix --force`
proposerait de rétrograder Next en 9.x, ce qui casserait l'app.

⚠️ La branche par défaut du dépôt est **`master`**, pas `main` — `main` est une vieille
branche abandonnée qui a divergé. Repartir de `master`.

## Après un merge : vérifier le DÉPLOIEMENT, pas seulement la CI

**CI verte ne veut pas dire « en ligne ».** Ce sont deux systèmes indépendants : la CI
juge le code, Vercel construit et sert. Un merge peut passer le gate et ne jamais être
déployé — la branche reste verte, le site continue de servir l'ancien build, et rien
n'est rouge nulle part.

Vécu le 31/07/2026 : quatre projets Vercel ont cessé de créer des déploiements pendant
~3 h (l'intégration Git n'a rien reçu). DriveAI et JobAI ont rattrapé au push suivant ;
BatchChef et Hubperso n'en ont pas eu — leur commit d'en-têtes de sécurité est resté
**cinq jours** en attente sans que personne ne le voie. BatchChef servait toujours des
réponses sans aucun en-tête de sécurité alors que la PR était mergée.

Donc, après un merge qui change ce qui est servi (en-têtes, `next.config.ts`,
middleware, variables de build) : vérifier qu'un déploiement de production a bien été
créé et qu'il est `READY`, puis **contrôler l'effet sur la réponse HTTP réelle** — un
en-tête se lit dans la réponse, il ne se déduit pas du fichier source. Rattrapage :
tableau de bord Vercel → Deployments → « … » → Redeploy.

## Style (hérité du CLAUDE.md global de Marc)

- Réponses, commits et docs **en français** (`feat:`, `fix:`, `docs:`…).
- TypeScript strict, pas de `any` silencieux. Erreurs honnêtes, jamais avalées.
- Pas d'emoji dans l'UI ni les docs (sauf demande explicite).
