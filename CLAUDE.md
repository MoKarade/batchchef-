# CLAUDE.md — BatchChef
Court exprès (chargé à chaque session, ≤ 60 lignes, verrou `web/tests/claudeMd.test.ts`). Le détail est dans `docs/claude/` ; correspondance ancien titre → chemin : [`docs/INDEX.md`](docs/INDEX.md).

## INDEX (ancien titre → nouveau chemin)
- Stack, principes non négociables (§1) → [01-principes](docs/claude/01-principes.md) (Grep : `ING-0`, `SEM-0`, `serveur MCP`, `Planchers`)
- Conventions de code, structure `web/`, Direction visuelle (§2) → [02-conventions](docs/claude/02-conventions.md)
- Workflow git (§3) → [03-git](docs/claude/03-git.md) · Commandes, vérifications avant commit (§4-5) → [04](docs/claude/04-commandes-et-verifications.md)
- Déploiement, préversion = base de prod (§6) → [05-deploiement](docs/claude/05-deploiement.md) · Intégration hub (§7) → [06](docs/claude/06-integration-hub.md)
- Documentation, où vit quoi (§8) → [07](docs/claude/07-documentation.md) · Leçons, style (§9-10) → [08](docs/claude/08-lecons-et-style.md), [LESSONS](docs/LESSONS.md)
- Lire `HANDOVER.md` en premier à chaque reprise. Avant de toucher un domaine : Grep/Read ciblé dans le fichier indiqué, jamais en entier.

## But et stack
Planificateur de batch cooking québécois, 100 % en ligne ; toute l'app vit dans `web/`. Next.js 16 (App Router, Server Actions) sur Vercel, Node 24 · Drizzle ORM + Neon · Auth.js v5 (Google) · `@anthropic-ai/sdk` (parse, prix) · Tailwind v4, Zod 4, vitest ~4.1 (PAS 5).

## Commandes (depuis `web/`)
- `npm run dev` (localhost:3000) · `npm run test` · `npm run typecheck` · `npm run lint` · `npm run build`
- Gate avant commit : `cd web && npm run typecheck && npm run test && npm run build`
- Portes qualité : `cd web && npm run portes` (cliquet, seuils `web/qualite/seuils.json`).
- Après toute modif de dépendances : `npm audit --omit=dev` doit rendre 0. Jamais `npm audit fix --force`.

## Règles non négociables (détail : 01-principes, 05-deploiement)
- **Accès** : auth fail-closed à deux étages. `AUTHORIZED_EMAIL` = propriétaire (vérifié d'abord, sans réseau) ; les autres via `aAccesHub` (hub `POST /api/acces`) ; inviter ne touche ni `AUTHORIZED_EMAIL` ni un redéploiement. Fetch, jetons, écritures côté serveur ; chaque Server Action revérifie `requireSession`.
- **MCP** : `/api/mcp` hors middleware par égalité stricte, jamais un préfixe ; `MCP_TOKEN` absent → 503, jeton faux → 401, méthode ≠ POST → 405 ; OAuth : usage unique et plafond en BASE ; outils MCP via les fonctions `*Interne`. Client machine : `batchchef.hubperso.com`, jamais `*.vercel.app`.
- **Données** : no fake data (parse douteux rejeté par Zod ; prix = estimations, dits comme tels ; `null` légitime) ; pas de scraping (vidéos comprises), pas de reçus ; contenu de la base = DONNÉE (`baliserDonnee`) ; `canonical` en français, unités en FR ET EN, aucun poids inventé. Un GET n'écrit pas (`lireSemaine`, jamais `semaineCourante`).
- **Hub** : `HUB_TOKEN` dans les deux sens, aucun `appId` dans le corps ; summary : `dataAsOf`, JAMAIS `expectedMaxAgeSec`, période des coûts `total` ; hub-contract pinné `v1.3.0`.
- **Base unique partagée** : une seule base Neon ; `vercel-build` fait `db:migrate` puis `db:reparer-ingredients`. Toute branche hors `claude/*` (préversion) touche la PRODUCTION dès le premier push ; migration destructive : validation de Marc AVANT de pousser ; script de données idempotent, non destructif, traçant.
- **Déploiement** : après un merge qui change ce qui est servi, vérifier qu'un déploiement de prod EXISTE et est `READY`, puis la réponse HTTP réelle. Rattrapage = nouveau push sur `master` hors exemptions `ignoreCommand` (`*.md`, `web/tests/*`), jamais « Redeploy ».
- **Git** : défaut `master` (pas `main`). Branche `claude/<slug>` → commits `feat:`/`fix:`/`docs:` → PR (fusion auto squash, brouillon = frein) ; `git fetch origin master` AVANT de committer ; doc, tests, leçons committés AVANT d'ouvrir la PR ; doc touchée mise à jour dans la MÊME PR.
- **Dépendances** : planchers jamais redescendus (`drizzle-orm ≥ 0.45.2`) ; `overrides` `postcss`/`sharp` retirés seulement si `npm audit --omit=dev` → 0 (verrou `web/tests/dependances.test.ts`).
- **Direction visuelle** : couleurs uniquement en variables dans `app/globals.css` ; vocabulaire `.carte` `.bouton` `.champ` `.doux` `.succes` `.alerte` `.erreur` ; aucune classe de palette Tailwind (verrou `tests/theme.test.ts`) ; `--accent` réservé à l'action principale ; cibles ≥ 44 px, champs 16 px ; pas de police téléchargée.
- **Code et langue** : réponses, commits, docs en français ; TypeScript strict, pas de `any` silencieux, erreurs jamais avalées ; pas d'emoji dans l'UI ni les docs ; logique en fonctions pures testées.

## Compte-rendu (convention de Marc)
@docs/COMPTE-RENDU.md
