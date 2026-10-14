# ÉTAT — BatchChef

> Photographie courte de l'état du projet, pour un chef ou un spécialiste qui arrive sans
> contexte. La référence complète et datée reste `HANDOVER.md` (racine) et `BACKLOG.md` —
> ce fichier n'en est qu'un résumé daté, pas une source concurrente.
>
> Rédigé le 2026-09-28 (jusqu'au commit `5c7fcfe`, #134), **remis à jour le 2026-10-14**
> contre le code et l'historique git jusqu'au commit `e0a22e7` (#170) : `web/package.json`,
> `web/package-lock.json`, `web/qualite/seuils.json`, `.github/`. Sauf mention contraire,
> aucun chiffre de production n'est mesuré ici : la production n'est pas accessible d'ici.
>
> **Gel décidé par Marc le 14/10 : aucun nouveau travail sur les apps tant que le plan de
> réduction du temps des PR est en cours.**

## Fait (cycle en service)

Le cycle **importer une recette → composer un batch → faire l'épicerie → cuisiner** est en
ligne (`batchchef.hubperso.com`) et s'arrête là volontairement (décision de Marc, 17/08).
S'y ajoutent : le catalogue de 10 170 recettes cherchable, l'assistant (`/assistant`, outils
sur la base réelle), la proposition de semaine (« Ta semaine » : 3 plats + 1 dessert,
remplaçables, prix/temps/difficulté affichés), le serveur MCP distant (`POST /api/mcp`,
7 outils, OAuth 2.1 pour le connecteur claude.ai + jeton direct pour Claude Code) et le
widget hub (`GET /api/hub/summary`).

Chantiers fermés et verrouillés par test : le classement du catalogue (`ING-*`, `CAT-*`,
`SEM-*`), la sécurité de la CI (jeton GitHub, `--ignore-scripts`, gitleaks/SonarCloud), la
PWA Android (icône `maskable`, `id` d'installation), et — depuis le 27/09 — l'audit sécurité
de l'import par URL (SSRF) et des routes MCP/OAuth (#131).

## En cours / pas encore vu en usage

- **Le chantier SEMAINE (`SEM-01/02/03/05`) est livré mais jamais exercé en production** :
  aucune de ses quatre surfaces (carte, remplacement par le chat, re-tirage, prix) n'a été
  vue par une session avec accès réel. Premier usage réel = premier vrai test.
- Deux points PWA que seul un vrai téléphone tranche (backlog) : le comportement de
  `launch_handler` sur un partage Instagram, et si le lien du hub ouvre l'app installée.
- `ING-09` (26 lignes irréductibles, 0,03 % du catalogue) — à rouvrir seulement si l'une
  gêne Marc en vrai, pas parce qu'elle traîne.
- Deux idées non arbitrées au backlog (unité inconnue comptée en pièces, budget confronté
  au réel) — à proposer avant de coder, jamais à trancher seul.
- **`HIST-01` — historique de ce qui a été cuisiné** : **fusionné le 29/09 (#148)**. Écran
  `/historique`, table `meal_history` (migration `0017`). Démarre VIDE à la mise en ligne ;
  C1, C3 et C4 du plan (déploiement `READY`, table présente, terminer / reculer / supprimer
  un vrai batch) ne sont consignés nulle part comme contrôlés en production.
- **Refonte visuelle** (#140, 29/09) : thème sombre seul, six écrans refondus — jamais
  décrite comme vue par Marc en production dans le dépôt.
- **Test instable** (backlog, 14/10) : délais dépassés sur des tests PGlite
  (`tests/sante.test.ts`, `tests/historiqueDb.test.ts`), cause non établie.

## Bloqué / risque ouvert

- 🔴 **`DEPLOI-MUET`** (constaté le 15/09, re-mesuré le 25/09) — le projet Vercel
  `batchchef-glu8` a cessé, par intermittence, de créer un déploiement à certains merges sur
  `master` (ni `READY` ni même `CANCELED`) : 4 merges sur 5 muets le 24/09, puis un
  rattrapage automatique le 25/09 par le hasard d'un commit de doc (`build-necessaire.sh`
  compare au dernier commit **déployé**, pas au précédent, donc un trou se referme au push
  suivant, quel qu'il soit). **Cause non établie** — hors de portée d'ici (tableau de bord
  Vercel, `*.hubperso.com`). Conséquence pratique : après tout merge qui change ce qui est
  servi, vérifier qu'un déploiement `READY` existe réellement, ne jamais supposer « CI verte
  ⇒ en ligne » (voir `docs/claude/05-deploiement.md`). Au 14/10 : aucune trace dans le dépôt
  d'une résolution après le 25/09 ; à vérifier avant tout prochain merge sensible.
- ⚠️ **Une préversion peut encore lire/écrire la base de PRODUCTION au runtime.** Le
  correctif #129 (27/09) a fermé la porte des **migrations** : `vercel-build` ne lance
  `db:migrate`/`db:reparer-ingredients` que si `VERCEL_ENV=production` (échec fermé sinon).
  Le risque restant, documenté comme tel : le **runtime** d'une préversion garde
  `DATABASE_URL` et lit/écrit donc la base réelle tant que Marc n'a pas créé une branche
  Neon dédiée aux préversions. Au 14/10, rien dans le dépôt n'indique que cette branche existe.
- Le connecteur claude.ai (OAuth) et le MCP ont été audités le 27/09 (#131, import SSRF +
  tests MCP/OAuth) — pas de faille ouverte connue à ce jour dans les documents lus.

## Portes qualité (cliquet, `web/qualite/seuils.json`, `mis_a_jour` : 2026-09-29, #145)

| Porte | Seuil |
|---|---|
| Erreurs de typecheck | 0 |
| Erreurs de lint | 0 |
| Avertissements de lint | 0 |
| Échecs de tests | 0 |
| Couverture lignes, cœur (`lib/`) | ≥ 73,5 % |
| Couverture lignes, globale | ≥ 54,9 % |
| Couverture branches, globale | ≥ 51,6 % |
| Problèmes de code mort (knip) | ≤ 1 |
| Violations d'architecture (dependency-cruiser) | 0 |
| Score de mutation (Stryker) | ≥ 40,6 % |

Un seuil ne redescend jamais sans `--forcer` et une décision de Marc. Les seuils de
couverture ont été redéfinis le 24/09 lors de la montée à vitest ~4.1 (remappage V8
différent, même code, mesure différente) — pas une régression réelle — puis resserrés le
29/09 (#145, après les tests PGlite de #142 et le code mort soldé par #146).

## Repères techniques rapides

Au 14/10 (versions installées d'après `web/package-lock.json`) : Next 16.3.8 (plage
`^16.3.5`) · React 19.3 · Node 24 · Drizzle ORM 0.45.3 + Neon · Auth.js v5 (`next-auth`
5.0.0-beta.32, Google) · `@anthropic-ai/sdk` 0.127 · Zod 4.6.5 · Tailwind v4 · vitest 4.1.11
(pas 5 : Stryker ne le pilote pas encore, score faux constaté) · `@mokarade/hub-contract`
épinglé `#v1.3.1`. Tests : 907 dans 54 fichiers (mesuré le 14/10). Détail et raisons :
`docs/ARCHITECTURE.md`.

## PR récentes notables (jusqu'au 14/10, commit `e0a22e7`)

| PR | Date | Contenu |
|---|---|---|
| #170 | 14/10 | Test instable consigné au backlog |
| #169 | 14/10 | `npm audit fix` : sharp 0.35.5 et source-map-js 1.2.2 (2 failles hautes, lockfile seul) |
| #162 | 30/09 | 5 alertes Dependabot moyennes (dépendances de dev) |
| #155, #158, #159, #161 | 30/09 | Kit auto-merge resynchronisé jusqu'au modèle 1.16.0 ; commit-gate branché (#158) |
| #151, #152 | 29/09 | Actions de `ci.yml` épinglées par SHA ; gitleaks 8.30.1 |
| #154 | 29/09 | `GET /api/sante`, sonde de santé publique pour la vigie |
| #148 | 29/09 | `HIST-01` — historique de ce qui a été cuisiné |
| #147 | 29/09 | CSP en blocage réel (`Content-Security-Policy`, plus `Report-Only`) |
| #143 | 29/09 | `lib/actions.ts` découpé par domaine, `*Interne` hors `"use server"` (M2) |
| #144 | 29/09 | Correctif `SEM-BUG-TYPE-NUL` |
| #142, #145, #146, #150 | 29/09 | Tests PGlite (semaine, assistant), seuils resserrés, code mort soldé |
| #140 | 29/09 | Refonte visuelle (thème sombre seul, six écrans) |
| #135, #137, #138 | 28/09 | `ETAT.md`/`ARCHITECTURE.md`, galerie de maquettes |
| #134 | 27/09 | Attestation de pole-securite en CI (`securite_login`, `securite_user_id`) |
| #129 | 27/09 | `vercel-build` ne migre/ne répare la base que sur un build de production |
| #133 | 27/09 | Resynchronisation du kit auto-merge sur le modèle Atelier 1.9.0 |
| #132 | 26/09 | Plus de préversion Vercel pour les branches `agence/*` et `dependabot/*` |
| #128 | 26/09 | Blocage technique de l'auto-fusion sur les chemins sensibles |
| #131 | — | Import par URL sans SSRF + tests des routes MCP/OAuth (audit sécurité) |
| #130 | — | `CLAUDE.md` réduit à 34 lignes, détail déplacé dans `docs/claude/` |
| #127 | — | `web/README` et `CLAUDE.md` rattrapent le code réel |
| #125–126 | 25/09 | État daté du 25/09 dans `HANDOVER.md` ; correction : la production avait rattrapé `master` seule |

Les PR #126 à #170 ci-dessus sont reprises depuis l'historique git (sujets et fichiers des
commits), pas depuis une doc narrative — rien n'est ajouté au-delà de ce qu'ils disent.

## Où lire le détail

- `HANDOVER.md` (racine) — état daté ; section « État au 14/10/2026 » en tête.
- `BACKLOG.md` (racine) — tâches ouvertes, avec case à cocher.
- `docs/claude/01` à `08` — l'ancien `CLAUDE.md` détaillé, section par section (`docs/INDEX.md` fait le lien ancien §N → nouveau fichier).
- `docs/adr/0001` et `0002` — décisions du serveur MCP et de l'OAuth.
- `docs/LESSONS.md` — leçons transverses.
