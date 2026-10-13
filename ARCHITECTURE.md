# BatchChef - Architecture et contrats

> Carte du dépôt pour NotebookLM (carnet du dépôt et Carnet Maître inter-apps). À mettre à jour dans la même PR quand une interface publique, une dépendance externe ou un terme métier change. Rédigé à partir de master au commit 6597554dbd17, le 2026-10-13.

## 1. Responsabilité du dépôt
**Domaine :** cuisine en lot (batch cooking) québécoise : recettes, batchs, listes d'épicerie, budget estimé.
**Rôle :** importer des recettes (URL, texte ou vidéo) ou les piocher dans un catalogue de 10 188 recettes Marmiton, composer des batchs, générer la liste d'épicerie avec un prix estimé, proposer une semaine (3 plats + 1 dessert) et garder l'historique de ce qui a été cuisiné. Toute l'application vit dans `web/` ; elle publie un widget au hub perso et expose un serveur MCP en lecture et écriture.
**Déploiement :** Vercel, sur `batchchef.hubperso.com`. Branche par défaut `master` (pas `main`). Une seule base Neon partagée entre production et préversions.

## 2. Interfaces publiques (contrats)
*Ce que les autres dépôts, Hubperso, Claude ou l'utilisateur peuvent appeler. Chemins servis depuis `web/app/`.*
- `GET /api/hub/summary` : résumé pour le hub (`@mokarade/hub-contract`) ; même jeton hub dans les deux sens, aucun `appId` dans le corps ; porte `dataAsOf`, jamais `expectedMaxAgeSec` ; coûts publiés sur la période `total`. La carte du hub montre la semaine et « Batchs (30 jours) » (30 jours glissants).
- `POST /api/mcp` : serveur MCP en JSON-RPC écrit à la main (ADR-0001). Jeton porteur : intégration non configurée → 503, jeton absent ou faux → 401, méthode autre que POST → 405. Route exemptée du middleware de session par égalité stricte, jamais par préfixe. Le client doit viser `batchchef.hubperso.com`, jamais une URL `*.vercel.app`.
- Outils MCP : 7 outils (4 en lecture, 3 en écriture). Noms documentés : `lister_batchs`, `chercher_recettes`. Les écritures (créer un batch, copier une recette du catalogue, cocher un article) passent par `creerBatchInterne`, `ajouterDuCatalogueInterne`, `cocherArticleInterne`. Noms des autres outils : [à compléter] (déclarations dans `web/lib/mcp/`). L'import d'une recette par URL n'est volontairement pas exposé.
- OAuth 2.1 mono-utilisateur pour le connecteur claude.ai (ADR-0002) : `/api/mcp/oauth/authorize`, `/api/mcp/oauth/register`, `/api/mcp/oauth/token`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` (méthodes : ?). Jetons signés HMAC-SHA256, usage unique et plafond de tentatives tenus en base.
- `/api/transcription` : transcription audio pour l'import vidéo (méthode : ?).
- `/api/sante` : sonde de santé (méthode : ?).
- `/api/auth/[...nextauth]` : connexion Auth.js v5 (fournisseur Google).
- Pages : `/`, `/recettes`, `/recettes/[id]`, `/catalogue`, `/catalogue/[id]`, `/batchs`, `/batchs/nouveau`, `/batchs/[id]`, `/courses/[id]`, `/assistant`, `/historique`, `/partage`, `/login`.
- Server Actions : `web/lib/actions/*.ts` (assistant, batch, catalogue, courses, import, recettes, semaine) ; chacune revérifie `requireSession`.
- Contrat Hub : expose le summary ; consomme l'autorisation du hub (`POST /api/acces` via `web/lib/accesHub.ts`). Le hub fournit l'autorisation, jamais l'authentification.

## 3. Dépendances externes
*Ce que ce dépôt appelle.*
- **Autres dépôts de Marc :** `hub-contract` (paquet `@mokarade/hub-contract`, épinglé sur v1.3.1 dans `web/package.json`) ; Hubperso (contrôle d'accès). FinanceAI est cité comme modèle de la solution OAuth, pas comme dépendance.
- **Services externes :**
  - Vercel (hébergement, `@vercel/analytics`) ; Neon Postgres via Drizzle.
  - Anthropic (`@anthropic-ai/sdk`) : parse des recettes importées, estimation des prix d'épicerie, assistant intégré qui interroge la base par outils.
  - Google : connexion (Auth.js) et export vers Google Tasks (`web/lib/googleTasks.ts`).
  - Groq : transcription audio de l'import vidéo (selon `HANDOVER.md`).
- **Données :** une base Neon unique (catalogue, bibliothèque, batchs, listes, OAuth, propositions de semaine, historique). `vercel-build` lance la migration puis la réparation des ingrédients, seulement en production. Catalogue amorcé depuis `web/data/batchchef.seed.db` (fichier versionné d'environ 24 Mo) par `npm run catalog:import`.

## 4. Carte structurelle
*L'arbre complet est généré automatiquement dans la source 00 ; ici, seulement le rôle des dossiers.*
```text
web/app/              -> pages Next.js (App Router) et routes HTTP
web/app/api/          -> summary du hub, MCP et son OAuth, transcription, santé, auth
web/components/       -> composants d'interface (recettes, catalogue, batchs, liste d'épicerie, semaine, conversation)
web/lib/              -> logique métier : unités, ingrédients, courses, semaine, type de plat, difficulté, historique
web/lib/actions/      -> Server Actions appelées par l'interface
web/lib/actionsInternes/ -> fonctions de travail partagées par l'interface et le MCP (*Interne)
web/lib/mcp/          -> protocole JSON-RPC, déclarations et outils MCP, OAuth
web/lib/assistant/    -> boucle et outils de l'assistant intégré
web/lib/llm/          -> appels au modèle (parse, prix)
web/lib/audio/, web/lib/video/ -> extraction audio et images pour l'import vidéo
web/lib/db/           -> client et schéma Drizzle
web/drizzle/          -> migrations SQL générées
web/scripts/          -> build Vercel, import du catalogue, réparation des ingrédients
web/tests/            -> suite Vitest (et tests de mutation Stryker)
docs/                 -> architecture, ADR, règles de travail (docs/claude/), état, leçons, maquettes de refonte
modeles/, scripts/hooks/, .github/ -> kit de fusion automatique, hooks de commit, CI
```

## 5. Glossaire métier (anti-hallucination)
- **Recette (bibliothèque) :** recette personnelle de Marc, importée ou copiée du catalogue.
- **Catalogue :** les recettes Marmiton du seed (10 170 servies sur 10 188 au seed) ; source des copies vers la bibliothèque.
- **Batch :** séance de cuisine en lot ; statuts planifié → courses → cuisine → terminé.
- **Liste d'épicerie (courses) :** articles agrégés d'un batch, avec prix estimés ; sel, poivre et eau en sont écartés.
- **canonical :** nom canonique d'un ingrédient en français, clé de regroupement de la liste d'épicerie.
- **Prix estimé :** estimation (LLM et filet déterministe), présentée comme telle ; pas de reçus, pas de scraping.
- **Semaine proposée :** 3 plats + 1 dessert, fabriquée à l'ouverture de l'app (table `week_picks`) ; lue par `lireSemaine`, créée par `semaineCourante` (jamais depuis un GET ou un outil).
- **Type de plat :** une de sept familles estimées (plat, entrée et apéro, accompagnement, soupe, salade, dessert, sauce et condiment) ; correction manuelle indexée par `source_url`.
- **Difficulté :** note de 1 à 5 étoiles, relative au catalogue (quintiles), qui mesure l'effort et non la technique.
- **Historique (`meal_history`) :** trace des recettes d'un batch passé à « Terminé » ; « cuisiné », jamais « mangé ».
- **Fonctions `*Interne` :** fonctions de travail partagées, pour que Claude subisse les mêmes garde-fous que Marc.
- **baliserDonnee :** balisage du contenu de la base comme donnée avant de le passer à un LLM.
- **Préversion = base de prod :** toute branche hors `claude/*` touche la production dès le premier push.
- **Identifiants de lots :** préfixes du backlog (`ING-`, `SEM-`, `CAT-`, `HIST-`, `DEPLOI-MUET`).

## 6. Pour aller plus loin
- `docs/ARCHITECTURE.md` : choix techniques réels, MCP et OAuth · `CLAUDE.md` : règles de travail · `HANDOVER.md` : état courant et historique
- `docs/adr/0001-serveur-mcp-distant.md`, `docs/adr/0002-oauth-pour-le-connecteur-claude-ai.md` : décisions
- `docs/claude/` : principes, conventions, git, déploiement, intégration hub · `docs/ETAT.md` : état · `web/README.md` : démarrage et configuration
