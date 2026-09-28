# ARCHITECTURE — BatchChef

> Choix techniques réels et pourquoi, pas un plan idéal. Sources : `docs/adr/0001` et
> `0002`, `docs/claude/01-principes.md`, `CLAUDE.md` (en-tête) et `web/package.json`.
> Rédigé le 2026-09-28 ; aucun choix ci-dessous n'est inventé — quand une alternative
> écartée n'est pas documentée, ce fichier le dit plutôt que de la supposer.

## Vue d'ensemble

Toute l'app vit dans `web/`. Next.js (App Router, Server Components + Server Actions) sur
Vercel, Drizzle ORM sur Neon (Postgres serverless), Auth.js v5 (Google), `@anthropic-ai/sdk`
pour le parse de recettes et l'estimation des prix, Tailwind v4 pour le style, Zod pour la
validation, vitest pour les tests.

## Stack et pourquoi

- **Next.js + Vercel.** Choisi pour « aucune commande à taper » côté Marc : un déploiement
  se fait au push, sans binaire local à lancer ni à relancer. C'est cette même contrainte qui
  a écarté un serveur MCP local (voir plus bas).
- **Drizzle ORM + Neon (Postgres serverless).** Une seule base pour toutes les tables
  (catalogue, bibliothèque, batchs, listes, OAuth, propositions de semaine). Conséquence
  directe et documentée : Vercel construit aussi les préversions, donc `vercel-build`
  (`db:migrate` + `db:reparer-ingredients`) peut toucher la base de PRODUCTION avant tout
  merge — voir `docs/claude/05-deploiement.md` pour le garde-fou en place depuis le 27/09
  (les migrations ne tournent qu'en `VERCEL_ENV=production`) et le risque encore ouvert
  (le runtime d'une préversion garde `DATABASE_URL`).
- **Auth.js v5 (Google).** BatchChef garde ce fournisseur alors que JobAI et CarAI en ont
  changé — choix documenté comme un maintien, pas un changement récent. L'autorisation est
  à deux étages : `AUTHORIZED_EMAIL` (le propriétaire, vérifié en premier et **sans appel
  réseau**, pour qu'une panne du hub ne mette pas Marc à la porte) puis `aAccesHub`
  (interrogation du hub perso pour toute autre adresse). Le hub fournit l'**autorisation**,
  jamais l'authentification.
- **`@anthropic-ai/sdk` (SDK Anthropic).** Utilisé pour deux choses distinctes : le parse
  d'une recette importée (texte ou vidéo) et l'estimation des prix d'épicerie ; et pour
  l'assistant intégré (`/assistant`), qui interroge la base par des outils plutôt que par un
  pré-filtre SQL suivi d'un seul appel — décision de Marc (19/08/2026) pour lui permettre de
  creuser en plusieurs allers-retours.
- **Zod.** Sert la règle « No fake data » : un parse douteux est rejeté plutôt qu'inséré sale.
  Le schéma tolère la FORME (un modèle peut rendre les instructions en tableau plutôt qu'en
  texte) mais jamais le FOND — une quantité incertaine n'est jamais devinée.
- **Tailwind v4**, avec une règle propre au projet : les couleurs vivent uniquement en
  variables dans `app/globals.css`, jamais en classes de palette Tailwind directes (verrouillé
  par `web/tests/theme.test.ts`, après une régression de contraste vue par Marc le 14/08/2026).
- **vitest, actuellement figé à ~4.1 (pas 5).** Choix récent et documenté : l'outil de
  mutation Stryker ne sait pas encore piloter vitest 5 et rendait un score de mutation faux
  (mesuré 5,2 % au lieu de 40,6 %). Ce n'est pas un choix de fond contre vitest 5, mais une
  dépendance à la maturité d'un outil tiers — à revoir quand Stryker suivra.

## Le serveur MCP (`POST /api/mcp`) — ADR-0001

Deux décisions de Marc ont fixé toute l'architecture de cette pièce : le serveur tourne
**à distance sur Vercel** (pas un binaire local à lancer), et il fait **lecture ET écriture**
dès le départ (pas d'étape lecture seule d'abord).

- **Le protocole JSON-RPC est écrit à la main ; le SDK officiel `@modelcontextprotocol/sdk`
  reste en devDependency.** Raison : ce SDK pèse 8,7 Mo et tire 17 dépendances runtime
  (express, hono, cors, jose...) pour un transport **à sessions**, alors qu'une fonction
  serverless Vercel n'a aucune session à garder — chaque appel est un processus neuf. Le SDK
  n'est pas jeté : il sert de **tripwire de versions** (`web/tests/mcp.test.ts`) pour que les
  constantes de protocole recopiées à la main ne dérivent pas en silence.
- **Les écritures passent par les fonctions de travail de l'app (`creerBatchInterne`,
  `ajouterDuCatalogueInterne`, `cocherArticleInterne`), jamais par du SQL réécrit.** Un batch
  créé par Claude subit donc exactement les mêmes garde-fous (sel/poivre écartés, prix
  estimés, dédup du catalogue) qu'un batch créé au doigt par Marc.
- **L'autorisation est un jeton porteur ; son absence rend 503, pas 401.** Trois réponses
  distinctes et volontaires : `MCP_TOKEN` absent → 503 (intégration éteinte) ; jeton
  absent/faux → 401 (appelant non autorisé) ; méthode ≠ POST → 405. Les confondre rendrait
  indiscernables « pas configuré » et « quelqu'un frappe à la porte ».
- **La route est exemptée du middleware de session par ÉGALITÉ stricte, jamais par préfixe.**
  Sous la garde de session, un appelant machine recevrait une redirection HTML vers `/login`
  au lieu du JSON-RPC — le serveur paraîtrait muet sans qu'aucune erreur n'apparaisse.

**Ce qui n'est pas exposé, et pourquoi** : l'import d'une recette depuis une URL. Il
court-circuiterait l'écran de validation (« le LLM propose, le code valide, Marc confirme »)
— un import sans relecture mettrait en base des quantités que personne n'a vues.

**Alternatives rejetées (ADR-0001)** :
- SDK officiel en production — rejeté pour le poids et un transport à sessions inutile ici.
- Serveur MCP local (stdio) — rejeté : demanderait à Marc de l'installer et de le lancer.
- Lecture seule d'abord — proposée, refusée par Marc (viderait l'intérêt d'un accès distant).
- Réécrire les écritures en SQL dans le serveur MCP — rejeté : deux implémentations d'une
  même règle divergeraient, et les garde-fous doivent valoir pour Claude comme pour Marc.

## OAuth 2.1 mono-utilisateur pour le connecteur claude.ai — ADR-0002

Le jeton porteur direct de l'ADR-0001 suffit à Claude Code, mais pas à l'interface
« Ajouter un connecteur personnalisé » de claude.ai, qui n'accepte **qu'une URL**, sans champ
pour un en-tête d'authentification. FinanceAI avait buté sur le même mur le 13/07/2026 et
l'avait résolu par un OAuth 2.1 mono-utilisateur ; BatchChef reprend la même solution.

- **Sans état** : jetons et codes sont des charges JSON signées HMAC-SHA256, vérifiables par
  n'importe quelle instance sans rien stocker — nécessaire en serverless.
- **Une exception à l'apatridie : l'usage unique.** Le code d'autorisation ne doit servir
  qu'une fois. Contrairement à FinanceAI (qui tient cette liste en mémoire sur une instance
  Cloud Run chaude), BatchChef la tient en **base** (`mcp_oauth_consumed`) : Vercel démarre
  des instances à froid et en parallèle, donc une liste en mémoire ne protégerait presque
  jamais rien.
- **Un seul secret, deux usages dérivés.** `MCP_TOKEN` sert de jeton direct ET de clé que Marc
  tape sur la page de consentement ; la clé de signature en est dérivée par HMAC.
  `MCP_OAUTH_SIGNING_KEY` reste surchargeable comme kill-switch : la changer révoque toutes
  les connexions OAuth sans toucher au jeton que Claude Code utilise directement.
- **Un plafond de tentatives en base**, pour la même raison que l'usage unique : un compteur
  de process en mémoire serait remis à zéro par l'instance suivante.

**Alternatives rejetées (ADR-0002)** :
- Jeton dans l'URL (`/api/mcp/s/<jeton>`) — marcherait sans OAuth, mais un secret dans une
  URL est journalisé par la plateforme et ne peut pas expirer.
- Ouvrir `/api/mcp` sans authentification — rejeté, la base contient les données de Marc.
- Attendre que claude.ai accepte les en-têtes — rejeté : pari sur le calendrier d'un tiers
  (FinanceAI attendait déjà depuis le 13/07 au moment de la décision).

## Ce qui n'est pas documenté

Les choix ci-dessus couvrent ce que les ADR et `docs/claude/` explicitent. Pour tout autre
choix (par exemple le détail interne du parse LLM des recettes ou de l'estimation vidéo),
aucune alternative écartée n'est nommée dans les documents lus — ne pas en inventer une :
voir `docs/claude/01-principes.md` pour ce qui est décrit, et `HANDOVER.md`/`BACKLOG.md`
pour l'historique des livraisons.

## Où lire le détail

- `docs/adr/0001-serveur-mcp-distant.md` et `docs/adr/0002-oauth-pour-le-connecteur-claude-ai.md`
  — décisions complètes, trade-offs assumés, vérifications.
- `docs/claude/01-principes.md` — tous les principes non négociables (no fake data, unités,
  langue, etc.), avec leur raison mesurée.
- `docs/claude/02-conventions.md` — structure de `web/`, direction visuelle.
- `docs/ETAT.md` — où en est le projet maintenant.
