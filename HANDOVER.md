# HANDOVER — BatchChef

> État courant. **À lire en premier** à chaque reprise de session, et à mettre à jour dans la
> MÊME PR que le code. Une doc périmée est pire que pas de doc.
>
> Créé le 2026-08-17 : le dépôt n'avait aucun document vivant, contrairement à tous les
> autres projets de Marc. Tout ce qu'une session savait mourait avec elle.

## Où en est l'app

Le cycle en place et déployé : **importer une recette → composer un batch → faire
l'épicerie → cuisiner**. Il s'arrête là, volontairement (décision de Marc, 17/08 — voir
« Ce qui vient d'être livré »).

| Domaine | État |
|---|---|
| Import par URL | En service (parse LLM + vérification, Zod) |
| Import vidéo (reel) | En service — enregistrement d'écran partagé depuis Android, images extraites DANS le navigateur, transcription audio en appoint |
| Catalogue | 10 188 recettes, cherchable, paginé |
| Batchs + liste d'épicerie | En service, prix estimés (couverture 100 %) |
| Export Google Tasks | En service |
| **Assistant** | **Neuf (19/08)** — `/assistant`, Claude fouille la base par outils ; les recettes citées deviennent des cartes cliquables qui s'ouvrent PAR-DESSUS le chat. ⚠️ Éteint si `ANTHROPIC_API_KEY` absente (dit à l'écran, pas une panne) |
| Widget hub | `GET /api/hub/summary`, contrat `@mokarade/hub-contract` |
| **Serveur MCP** | **Neuf (19/08)** — `POST /api/mcp`, 7 outils (4 lecture, 3 écriture). **BRANCHÉ ET VÉRIFIÉ EN USAGE RÉEL** le 19/08 : Marc a connecté le connecteur claude.ai (OAuth 2.1, ADR-0002), et les outils rendent ses vraies données. Claude Code reste possible par jeton direct. |
| Accès | Google mono-adresse + interrogation du hub (`lib/accesHub.ts`) |
| Analytics | `@vercel/analytics` posé. ⚠️ **Ne collecte rien tant que Web Analytics n'est pas activé dans le tableau de bord Vercel** — geste de Marc |

Production : `batchchef.hubperso.com` (Vercel, projet `batchchef-glu8`).
Gate : `typecheck` · `lint` · `test` · `build`. **328 tests**, 25 fichiers (19/08/2026).

## Ce qui vient d'être livré (17/08/2026)

- **`BOT-01` — l'assistant.** Onglet `/assistant` : Claude fouille les recettes et le
  catalogue par outils, en plusieurs allers-retours. Il cite le numéro de ce qu'il a lu et
  dit explicitement quand il compose.
- **`ING-02` — les quantités.** Perte mesurée de **58 % → 28 %** sur 50 unités réelles. La
  cause n'était pas la couche soupçonnée : la table d'unités connaissait mieux l'anglais que
  le français (`cloves` OK / `gousses` perdu). Dérive d'arrondi corrigée au passage (399,9 g
  au lieu de 400), et `stick` désambiguïsé par le nom (un bâton de cannelle valait 113 g).
- **`ING-01` — sel, poivre et eau** hors de la liste d'épicerie. Automatique, aucune liste à
  tenir, et l'écart est DIT sous la liste en nommant les ingrédients.
- **Retrait du stock de portions et du garde-manger.** Livrés le matin même, retirés le
  soir : Marc n'en veut pas. Le batch redevient `planifié → courses → cuisine → terminé`,
  sans suite. Les tables `portions` et `pantry` sont supprimées (migration `0008`).
- **Compteur d'accueil** (`ACC-01`, conservé) : il additionnait les articles non cochés de
  TOUS les batchs, terminés compris.
- **Verrou du socle visuel** (`web/tests/theme.test.ts`) après la régression texte blanc sur
  blanc signalée par Marc le 14/08.
- **Web Analytics** (PR #44), remise sur `master` après dix commits de dérive.

## Ce qui vient d'être livré (19/08/2026, soir)

- **`MCP-01` — serveur MCP distant.** `POST /api/mcp` : Claude Code ou l'app Claude peuvent
  fouiller les recettes, lire une liste d'épicerie, **et écrire** (créer un batch, copier une
  recette du catalogue, cocher un article). Décisions de Marc : distant sur Vercel, lecture
  **et** écriture dès le départ. Détail et alternatives rejetées : `docs/adr/0001`.
- Le JSON-RPC est écrit à la main ; le SDK officiel reste en **devDependency** et sert de
  tripwire de versions (`tests/mcp.test.ts`). `npm audit --omit=dev` reste à **0**.
- Les écritures passent par les fonctions de travail de l'app (`creerBatchInterne`…), pas par
  du SQL réécrit : un batch créé par Claude subit les mêmes garde-fous qu'un batch créé au
  doigt.

### Second lot du 19/08 — OAuth pour le connecteur claude.ai

Marc a essayé de brancher le connecteur : « me manque l'adresse ». L'adresse était bonne ;
l'interface de connecteurs ne prend **qu'une URL**, sans champ pour un en-tête. Un serveur à
jeton statique y échoue sans rien expliquer. FinanceAI avait buté sur le même mur le 13/07 et
l'avait résolu par un OAuth 2.1 mono-utilisateur — c'est ce qui est repris ici (ADR-0002).

- `MCP_TOKEN` est POSÉ (19/08). La clé de signature en est dérivée
  (`MCP_OAUTH_SIGNING_KEY` la surcharge — c'est le kill-switch).
- Deux tables neuves (`mcp_oauth_consumed`, `mcp_oauth_attempts`), migrations 0009/0010,
  appliquées au build. **En base et non en mémoire** : en serverless, un compteur de process
  compterait jusqu'à trois pour toujours.
- Vérifié par 11 sondes contre un serveur réellement démarré + 328 tests, discrimination
  prouvée par 7 mutations. Puis **en production** : les deux documents de découverte et la
  page de consentement répondent sur `batchchef.hubperso.com`.
- ⚠️ Trouvé en lisant les en-têtes de production : `form-action` de la CSP n'autorisait pas
  `claude.ai`. Sans effet aujourd'hui (Report-Only), mais le passage en enforcé aurait coupé
  le branchement à la dernière étape, silencieusement. Corrigé et verrouillé.

## Prochaine chose prévue

Rien d'engagé côté MCP : il est branché et en service. Un défaut de DONNÉES est apparu au
premier usage réel — voir `ING-03` au backlog (les noms d'ingrédients du catalogue portent des
morceaux de quantité : « À Soupe De Persil », « Ousses D'Ail », « S De Sel »).

⚠️ **L'assistant n'a jamais été essayé contre la vraie API** : cette session n'a pas de
réseau vers Anthropic. Le protocole, les bornes et le classement sont testés ; la boucle
elle-même ne l'est qu'à la lecture. Premier vrai usage = premier vrai test.

Le **serveur MCP**, lui, a été sondé contre un serveur réellement démarré (onze points :
négociation de version, notification sans réponse, 401/503/405, lot, panne d'outil rendue
en `isError`), **puis vérifié en production après le merge** : `GET
https://batchchef.hubperso.com/api/mcp` rend `405` avec le corps JSON de la route et
`x-matched-path: /api/mcp` — donc la route est servie, et l'exemption du middleware tient
(une redirection vers `/login` aurait signé le piège n°1). Déploiement `85984b6`, `READY`.

**Plus rien ne reste non vérifié** (19/08, fin de journée). Marc a branché le connecteur, et
les outils ont été appelés DEPUIS claude.ai sur la base de production : `lister_batchs` rend
ses cinq batchs réels, `chercher_recettes` croise ses ingrédients et nomme ce qui manque.
Cela clôt d'un coup les deux points qui étaient hors de portée d'ici : l'échange code ↔
jetons (il a forcément eu lieu, puisque l'appel est authentifié) et un POST authentifié en
production.

## ⚠️ Ce que le correctif des unités NE rattrape PAS

Constaté le 19/08 en vérifiant, pas en supposant : **l'unité brute n'est stockée nulle
part** (les trois tables d'ingrédients ne gardent que `g`/`ml`/`unite`). Conséquences :

| | rattrapé par le correctif FR/EN ? |
|---|---|
| Recettes importées AVANT le 19/08 | **Non** — le mot « gousses » a été perdu à l'import, aucune donnée ne permet de le reconstituer. Seule une ré-importation de la recette la retrouverait. |
| Catalogue (10 188) | **Oui, mais il faut le rebâtir** : `npm run catalog:import` relit `data/batchchef.seed.db` (24 Mo, toujours versionné) qui porte les unités d'origine. ⚠️ Le script fait `delete` puis ré-insère — commande sur la base de PRODUCTION, à faire valider par Marc. |
| Listes d'épicerie déjà créées | **Non** — sel et poivre y restent : le filtre s'applique à la création du batch. |
| Tout ce qui arrive maintenant | Oui. |

Depuis le 19/08, une conversion ratée CONSERVE ce que la source disait dans `note`
(`noteQuantiteNonConvertie`) : Marc lit « 2 cans » au lieu d'un « au goût » muet, et la
PROCHAINE amélioration de la table sera rattrapable. Le trou ci-dessus ne se recreusera pas.

## Pièges à connaître avant de toucher au code

Les non négociables sont dans `CLAUDE.md` (chargé à chaque session). Les trois qui
surprennent le plus :

1. **La branche par défaut est `master`**, pas `main`.
2. **Le service worker n'intercepte QUE des navigations** — sinon il avale les Server
   Actions et le navigateur affiche une erreur opaque, journaux serveur vides.
3. **CI verte ≠ en ligne.** Vérifier qu'un déploiement de production EXISTE, puis son effet
   sur la réponse HTTP réelle.

## Ce qui demande un geste de Marc

- Activer **Web Analytics** dans le tableau de bord Vercel (sinon la dépendance ne mesure rien).
- Le client MCP doit viser **`https://batchchef.hubperso.com/api/mcp`** — jamais une URL
  `*.vercel.app` : la protection Vercel du projet est en `all_except_custom_domains`, donc
  celles-là répondent 302 vers la page de connexion Vercel avant que l'app ne tourne.
- ~~Poser `MCP_TOKEN`~~ — **fait le 19/08**, connecteur branché et vérifié en usage réel.
- `GROQ_API_KEY` est posée (transcription audio active).
