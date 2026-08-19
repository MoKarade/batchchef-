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
Gate : `typecheck` · `lint` · `test` · `build`. **374 tests**, 27 fichiers (19/08/2026).

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

### Troisième lot du 19/08 — les noms d'ingrédients (ING-03)

Trouvé au premier usage réel du MCP, pas par un test. Le catalogue affichait « À Soupe De
Persil », « Ousses D'Ail », « S De Sel » : l'app V3 retirait l'unité du texte source sans
frontière de mot. Ce n'était pas cosmétique — `canonical` est la clé de regroupement de la
liste d'épicerie, donc « à_soupe_de_persil » et « persil » faisaient deux lignes.

- **Mesuré avant de coder** : 2 371 abîmées sur 15 389, et la fonction réelle rejouée sur le
  corpus entier (0 vide, 0 restante, 0 clé oubliée). **965 fusions** gagnées.
- Réparation par retrait de PRÉFIXE plutôt que reconstruction depuis le texte source : les
  deux marchent, mais celle-ci ne dépend d'aucun fichier, donc elle tourne **au déploiement**
  (`vercel-build`) — aucune commande pour Marc. Idempotente, sort en une requête quand il n'y
  a plus rien.
- **Trois tables**, pas une : catalogue (la source), bibliothèque (copiée depuis le
  catalogue), listes d'épicerie (copiées à la création du batch).
- ⚠️ Ce qui n'est PAS fait : fusionner deux lignes d'une liste DÉJÀ créée. Les noms y
  deviennent lisibles et la fusion jouera aux prochains batchs ; réécrire des quantités sur
  une liste contre laquelle Marc a peut-être déjà fait ses courses serait une autre décision.

### Quatrième lot du 19/08 — les unités (ING-04), et ING-03 complétée

Trouvé en créant un batch de test par le MCP, à la demande de Marc : la liste disait
« **Gousses D'Ail — 3 g** ». Trois grammes d'ail, c'est une demi-gousse.

Même cause qu'ING-03 — l'extraction d'unité de la V3 ne bornait pas ses mots — mais cette
fois c'est la QUANTITÉ qui est fausse, donc ce que Marc ACHÈTE. Mesuré : `gousses`→`g`
1 926 lignes, `grosses`→`g` 167, `gouttes`→`g` 90, `clous`→`cl` 89, `gingembre`→`g` 35.

- **Pas réparable comme les noms.** `unit='g', qty=0.25` ne contient aucune trace de
  « gousse ». La vérité n'existe plus qu'en un endroit : `raw_text` dans le seed. La passe le
  lit donc, contrairement à ING-03 qui se suffisait d'un retrait de préfixe.
- **325 unités corrigées, 0 cas ambigu.** La passe s'abstient dès que les sources d'un même
  ingrédient se contredisent — « 200 g de gingembre » ne doit jamais devenir 200 unités.
- ⚠️ **ING-03 était INCOMPLÈTE**, découvert en mesurant celle-ci : ma détection ne connaissait
  que trois motifs. La restauration depuis la source en corrige **677**, sans énumérer.

### Audit exhaustif des ingrédients (19/08, `ING-06`)

Marc a demandé une vérification en profondeur (« au moins 98 % »). Méthode : rejeu complet
de l'état de production depuis le seed, **calibré** contre la vraie base via le MCP (11/11
sur deux recettes), puis jugé contre le TEXTE SOURCE.

**99,85 % correct** — 134 lignes en défaut sur 87 443, après trois correctifs que l'audit a
lui-même révélés :

1. **La restauration cherchait le mot d'origine dans le texte ENTIER**, donc trouvait
   l'unité avant l'ingrédient (« Es » ← « 1/2 tasses de fraises » → « Tasses »). Cette
   fausse restauration entrait en conflit avec la bonne et **annulait les deux** : 198
   lignes abîmées à cause d'une seule mal lue. Corrigé en cherchant d'abord dans la partie
   ingrédient, avec repli sur le texte entier — car le mot amputé EST parfois l'unité.
2. **Le nettoyage d'une préposition finale passait par la carte de correction**, donc était
   bloqué par les conflits — et « huile » en est une, soit 163 des 222 lignes. Une
   correction qui n'a besoin d'AUCUNE source ne doit pas dépendre d'un accord entre sources.
3. **Mon propre audit avait trois faux positifs**, tous dus à `\b` en JavaScript, qui ne
   traite pas `è`/`é` comme des lettres : « Eau Tiède » était signalée comme finissant par
   « de ». Il a fallu corriger l'instrument avant de croire la mesure.

Le reliquat (`ING-07`) est documenté au backlog, classe par classe.

## Prochaine chose prévue

Rien d'engagé. Le MCP est branché et en service ; `ING-03`, `ING-04` et `ING-05` sont livrés.

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
