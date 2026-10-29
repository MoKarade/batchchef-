# HANDOVER — BatchChef

> État courant. **À lire en premier** à chaque reprise de session, et à mettre à jour dans la
> MÊME PR que le code. Une doc périmée est pire que pas de doc.
>
> Créé le 2026-08-17 : le dépôt n'avait aucun document vivant, contrairement à tous les
> autres projets de Marc. Tout ce qu'une session savait mourait avec elle.

## 29/10/2026 : l'onglet « Apps » remplace le lien « ← Hub » (batchchef-#368, mission MoKarade/.github#846)

`web/components/NavApps.tsx` (serveur, `<details>` natif, zéro JavaScript) liste les AUTRES apps du parc (`web/lib/appsDuParc.ts`, copie d'app-template#212), monté dans le `pied` de `Coque` par `web/app/layout.tsx` (désormais `async`) seulement quand `navAppsAutorisee()` (`web/lib/navAppsMonter.ts`, propriétaire `AUTHORIZED_EMAIL` seul, échec fermé) est vrai. Un invité admis par le hub n'a donc plus de lien vers le hub. `NEXT_PUBLIC_HUB_URL` reste (accesHub, LIA). `web/vitest.config.ts` inclut les `.test.tsx`. Doc : `docs/claude/14-nav-apps.md`. Tests : `web/tests/navApps.test.tsx`, `appsDuParc.test.ts`.

## 29/10/2026 : `/api/sante` dit le commit servi (batchchef-#366, source MoKarade/.github#822)

La réponse porte aussi `commit` = les 7 premiers caractères de `VERCEL_GIT_COMMIT_SHA` (`lib/commitServi.ts`, pur), dans les cas `ok:true` ET `ok:false` ; le champ est absent si la variable est absente (local) ou n'est pas un sha hexadécimal, jamais une valeur inventée. Sert à voir quel commit un domaine sert après un retour en arrière (alias Vercel figé). Public : un sha n'est ni un secret ni une donnée de recette. `/api/sante/configuration` n'est pas touchée. Preuve : `curl https://batchchef.hubperso.com/api/sante` rend `"commit"` égal aux 7 premiers caractères du commit fusionné.

## 29/10/2026 : lia-ui v0.48.1, la discussion de LIA survit 2 min d'inactivité (batchchef-#364, mission MoKarade/.github#719)

Épingle `@mokarade/lia-ui` v0.48.1 (sha pelé `2e4c9e3`), seul changement (`web/package.json`, lock). Avant, après 2 minutes sans geste la discussion de LIA se fermait et s'effaçait partout (état partagé compris) : elle ne survivait ni à un rechargement ni au passage d'une app à l'autre (lia-ui#166). Rien à brancher côté BatchChef. Preuve : déploiement Vercel de production `READY` sur le commit fusionné, `batchchef.hubperso.com` répond (200 ou redirection vers la connexion).

## 28/10/2026 : `/assistant` devient l'atelier de LIA (batchchef-#346, mission MoKarade/.github#575)

Marc, 28/10/2026 : « tous les onglets assistants dans toutes les apps doivent être LIA avec son interface ». L'ancien chat (`Conversation.tsx`) est retiré : `/assistant` affiche LIA en pleine page (mode `atelier` de lia-ui, v0.44.0, épingle v0.47.0). **Le moteur ne change pas** : la boucle qui fouille les recettes et le catalogue (`lib/assistant/boucle.ts`) répond, par `POST /api/lia/ask` avec `atelier: true` ; la bulle des autres pages parle toujours au hub. Aucune écriture de faits côté BatchChef.
- **Une seule LIA** : `demarrerLiaApp` ne démarre pas la bulle sur `/assistant` (`enAtelier`) ; en y arrivant par la navigation, `components/AtelierLia.tsx` retire la bulle (`arreterBulle`) avant de monter `<Lia atelier>` avec les MÊMES réglages (`optionsLiaApp`, donc même pause et même état), et la remet au départ (`demarrerBulle`, différée d'un tour).
- **Réponse en texte et en blocs** (`lib/assistant/atelier.ts`, pur) : les marqueurs « [catalogue #482] » sont retirés du texte et deviennent un bloc `recette` (bouton qui ouvre la fiche PAR-DESSUS la page) ; « [semaine 3 ← catalogue #482] » devient un bloc `placement` (`components/CartePlacement.tsx`, aperçu avant le geste). Une recette inconnue de la base ne donne aucun bouton. Catalogue de blocs fermé (`BlocAtelier`, lib/lia/contrat.ts), validé des deux côtés.
- **Discussions** : l'historique est gardé par la page, en mémoire (`lib/assistant/discussions.ts`), comme l'ancien chat ; « Nouvelle discussion » et la liste de lia-ui marchent, recharger repart de zéro. L'historique part avec chaque question (20 derniers messages, tronqué aussi côté serveur) ; borne du corps 200 Ko pour l'atelier, 8 Ko pour la bulle.
- Vérifié : 1 203 tests, build, portes OK ; harnais navigateur (Chromium) : une seule LIA à chaque étape (arrivée directe, navigation aller et retour), question → réponse avec bouton, fiche ouverte par-dessus. [À vérifier] capture du PC de `/assistant` en production et une question réelle (« quoi cuisiner avec… »).
- **Suite** : la boucle `repondre` partira quand LIA aura l'outil « chercher et composer des recettes BatchChef » côté MemoryAI (MemoryAI#285) ; tâche de retrait sous la mission .github#719.

## 28/10/2026 : contrat hub v1.6.0 (batchchef-#362, mission MoKarade/.github#13)

`@mokarade/hub-contract` passe de v1.5.0 à v1.6.0 (sha pelé `df97e9f`), seul changement (`web/package.json`, lock, doc qui cite le tag). v1.6.0 ajoute un schéma optionnel (catalogue d'actions de l'assistant, `validateActionCatalog`) ; le format du summary ne change pas, `/api/hub/summary` reste identique. La ligne 7 de la grille de conformité ne signale plus de contrat en retard. Preuve : déploiement de production `READY` sur le commit fusionné, `GET /api/hub/summary` sans jeton rend 401.

## 28/10/2026 : lia-ui v0.48.0, barres HTML lues et état relu toutes les 2 min (batchchef-#360, mission MoKarade/.github#719)

Épingle `@mokarade/lia-ui` v0.48.0 (sha pelé `b0c8524`), seul changement (`web/package.json`, lock). v0.47.1 : l'état partagé n'est plus relu chaque minute mais toutes les 2 min, et seulement quand l'onglet est à l'écran. v0.48.0 : LIA lit aussi les barres de graphique dessinées en HTML (lia-ui#162, #164). BatchChef n'a pas de graphique, rien à brancher ni à relever ici. Preuve : déploiement Vercel de production `READY` sur le commit fusionné, `batchchef.hubperso.com` répond (200 ou redirection vers la connexion).

## 28/10/2026 : lia-ui v0.47.0, LIA lit les graphiques et ne scanne que sur demande (batchchef-#355, mission MoKarade/.github#575)

Épingle `@mokarade/lia-ui` v0.47.0 (sha pelé `7f1d7bb`), seul changement (`web/package.json`, lock). Marc, 28/10/2026 : « l'assistant voit toujours pas les graphes » et « l'animation de scan uniquement sur ce que je lui ai demandé ». v0.47.0 : LIA lit un graphique SVG (titre, axes, légende, valeurs écrites) sans code chez l'app ; les graphiques dessinés sur un `<canvas>` restent illisibles (limite connue). v0.46.0 : le scan des nanobots ne joue que sur ce que Marc a demandé d'analyser. v0.45.x et v0.44.x arrivent avec. Rien à brancher. Preuve : déploiement `READY` sur le commit fusionné, puis relevé du PC (question sur un graphique : la réponse cite les libellés écrits).

## 28/10/2026 : lia-ui v0.44.2, le menu du clic droit s'ouvre toujours sous le clic (batchchef-#353, mission MoKarade/.github#575)

Épingle `@mokarade/lia-ui` v0.44.2 (sha pelé `8881751`), seul changement (`web/package.json`, lock). Le menu d'un élément n'est plus borné à la zone de vie de LIA : il s'ouvre là où Marc a cliqué, dans la fenêtre (lia-ui#152, relevé du PC du 28/10, 15:48Z). v0.44.0 (mode atelier, inactif tant que l'app ne le demande pas) et v0.44.1 (tag automatique) arrivent avec. [À vérifier] relevé du PC après le déploiement de production.

## 28/10/2026 : lia-ui v0.43.0, le clic droit de LIA marche partout (batchchef-#350, mission MoKarade/.github#575)

Épingle `@mokarade/lia-ui` v0.43.0 (sha pelé `c0f1ff7`), seul changement (`web/package.json`, lock). Marc, 28/10/2026 : « faut qu'il marche partout ». Le clic droit (et l'appui long) de LIA s'ouvre maintenant sur le fond de page, dans une fenêtre modale `<dialog>.showModal()`, et même quand un gestionnaire de la page bloque le menu natif ; les champs de saisie gardent le menu du navigateur. Rien à brancher. Preuve : déploiement de production `READY` sur le commit fusionné, puis relevé du PC (lia-ui#147).

## BatchChef pousse ses sorties à MemoryAI (26/10/2026, tâche #320, mission MoKarade/.github#575)

Un batch créé, une recette ajoutée du catalogue et une liste d'épicerie terminée (dernier article coché) envoient un événement (`batch_cree`, `recette_ajoutee`, `liste_terminee`) à `POST /api/sorties` de MemoryAI, par le SERVEUR, après l'écriture réussie et hors du chemin de la réponse (`after()` de Next). Module : `web/lib/sortiesMemoryAI.ts` (constructeurs purs + envoi) ; points d'appel dans `lib/actionsInternes/{batch,catalogue,courses}.ts`, donc la Server Action et la route MCP sont couvertes d'un coup. Variables OPTIONNELLES : `MEMORYAI_SORTIES_TOKEN` (sans elle, rien ne part) et `MEMORYAI_URL` (défaut `https://memoryai.hubperso.com`) ; voir `docs/claude/09-variables.md`. Échec fermé et muet : délai de 2,5 s, erreur ou réponse non 2xx comptée dans un journal sans texte (ni titre, ni jeton, ni corps), jamais d'erreur pour Marc. `ref` stable par objet (`batchchef-batch-<id>`, `batchchef-recette-<id>`, `batchchef-liste-<id>`) : un renvoi ne double rien côté MemoryAI. Verrous : `web/tests/sortiesMemoryAI.test.ts` et `web/tests/sortiesActions.test.ts`. Preuve de production : après le déploiement de MemoryAI qui porte le jeton d'écrivain `MEMORYAI_TOKEN_BATCHCHEF_ECRITURE`, un batch créé apparaît dans MemoryAI avec sa date et `memoryai_chercher` le retrouve ; tant que ce n'est pas lu, la tâche reste `preuve-attendue`.

## LIA : lia-ui v0.42.2, une discussion fermée ailleurs reste fermée (28/10/2026, tâche #340, mission MoKarade/.github#575)

BatchChef épingle `@mokarade/lia-ui` v0.42.2 (sha pelé `9852596`), seul changement (`web/package.json`, `web/package-lock.json`). v0.42.1 ne rapprochait la discussion de l'onglet de celle de l'état partagé qu'à la première lecture, et seulement si la partagée était ouverte : une discussion fermée sur le hub était réécrasée par celle, plus ancienne, d'un onglet. v0.42.2 rapproche à chaque lecture (la plus récente gagne, fermée ailleurs = fermée ici) et écrit toujours la plus récente des deux. Rien à brancher côté app. Preuve : déploiement Vercel de production `READY` sur le commit fusionné, puis relevé du PC (lia-ui#144).

## LIA : lia-ui v0.42.1, la discussion la plus récente l'emporte (27/10/2026, tâche #338, mission MoKarade/.github#575)

BatchChef épingle `@mokarade/lia-ui` v0.42.1 (sha pelé `b8967ec`), seul changement (`web/package.json`, `web/package-lock.json`). Au montage, la discussion de l'onglet était datée « maintenant » et passait devant celle de l'état partagé : une question posée sur le hub ne se retrouvait pas dans CarAI. v0.42.1 range le vrai instant avec la discussion de l'onglet, et la plus récente gagne à la première lecture de l'état. Rien à brancher côté app. Preuve : déploiement Vercel de production `READY` sur le commit fusionné, puis relevé du PC (lia-ui#140).

## LIA : lia-ui v0.42.0, la hauteur de la bulle se révèle en douceur (26/10/2026, tâche #329, mission MoKarade/.github#575)

BatchChef épingle `@mokarade/lia-ui` v0.42.0 (sha pelé `cff04f4`), seul changement (`web/package.json`, `web/package-lock.json`). La bulle de v0.41.1 restait dans l'écran mais changeait de hauteur d'un coup à chaque réponse. v0.42.0 découvre la hauteur gagnée en 280 ms depuis le bord fixe, sans ombre coupée, et ne bouge rien avec `prefers-reduced-motion`. Rien à brancher côté app. Preuve : déploiement Vercel de production `READY` sur le commit fusionné, bundle servi contenant `inset(-24px)` sur batchchef.hubperso.com, puis mesure sur la page de connexion publique ; la tâche reste ouverte jusque-là.

## LIA : lia-ui v0.41.1, la bulle ne dépasse plus de l'écran (26/10/2026, tâche #327, mission MoKarade/.github#575)

BatchChef épingle `@mokarade/lia-ui` v0.41.1 (sha pelé `90dc7e7`), seul changement (`web/package.json`, `web/package-lock.json`). Le relevé du PC sur v0.41.0 montrait la bulle hors écran à l'ouverture et à l'arrivée de la réponse, puis un saut. v0.41.1 place sans glisser quand la taille ou l'écran change et fait grandir la bulle vers le haut quand elle est dans la moitié basse. Rien à brancher côté app. Preuve : déploiement Vercel de production `READY` sur le commit fusionné, bundle servi contenant `lia-ui__chat--glisse` sur batchchef.hubperso.com, puis relevé du PC ; la tâche reste ouverte jusque-là.

## LIA : lia-ui v0.41.0, sources cliquables et chat en bulle lissée (26/10/2026, tâche #323, mission MoKarade/.github#575)

BatchChef épingle `@mokarade/lia-ui` v0.41.0 (sha pelé `4d0c6f9`), seul changement (`web/package.json`, `web/package-lock.json`). v0.40.0 : les marques `[→lien]` d'une réponse de LIA deviennent une ligne « Sources » de petits liens (https, sans identifiants). v0.41.0 : le chat ne se replace plus à chaque image, reste dans l'écran visible (clavier du téléphone compris), glisse vers sa place, ne bouge pas quand le texte arrive. Retours de Marc du 26/10 : « incompréhensible, trop de texte, pas de liens » et « clunky, ça bug quand ça sort de la page ». Rien à brancher côté app. Preuve : déploiement Vercel de production `READY` sur le commit fusionné, bundle servi contenant `lia-ui__sources` et `lia-ui__chat--glisse` sur batchchef.hubperso.com, puis une réponse réelle de LIA ; la tâche reste ouverte jusque-là.

## vitest 5 (28/10/2026, tâche #236)

`vitest` et `@vitest/coverage-v8` passent en ~5.0.5, avec `vite` ^8 explicite (vitest 5 le demande ; sans lui Stryker ne charge pas son runner). Stryker 10.1.1 pilote vitest 5 : sur `lib/rayons.ts`, 97,01 % sous vitest 4.1 comme sous vitest 5 (#319). Typecheck, lint, 1172 tests, build et portes verts. Le job de mutation complet dépasse désormais 2 h sur un runner GitHub (les deux essais du 28/10 — vitest 5 sur la branche, vitest 4.1 sur `master` — ont été coupés à la limite de 120 min, sans score ; le run planifié du 19/10 avait pris ~101 min) : limite portée à 240 min dans `.github/workflows/ci.yml`. Score lu le 28/10/2026 (run 40757979034, job de 2 h 54 sur vitest 5) : **61,8 %**, seuil de 40,6 % inchangé, porte verte.

## Portée Google : lecture seule de Drive (28/10/2026, Hubperso#575 et #576)

`web/lib/jetonsGoogle.ts` demande maintenant `drive.readonly` en plus de l'identité et de Tasks, identique à Hubperso (cookie de session partagé : sans ça, une connexion par BatchChef retirerait le droit du jeton). Décision de Marc le 28/10/2026, pour l'onglet Bilans du hub (Hubperso#543). Lecture seule : BatchChef ne lit pas Drive lui-même. Marc doit se reconnecter une fois pour que le jeton porte la portée.

## Cache de prompts de l'assistant (28/10/2026, tâche #342)

Les tours de `lib/assistant/boucle.ts` mettent en cache outils + protocole (marqueurs `cache_control`) ; la taille du catalogue passe dans un bloc séparé après le marqueur. Le coût compte lecture (0,1 ×) et écriture (1,25 ×) de cache (`lib/llmUsage.ts`). Reste la preuve en production : `lu > 0` dans la trace `[llmUsage] assistant cache …` sur un appel réel, après la levée de la limite API du 01/11 (tâche #342, preuve attendue le 02/11/2026 08:00, heure du Québec).

Modèles (28/10/2026, tâche #344) : tout est en génération 5.5, plus aucun ancien identifiant dans `web/lib`. Parse, vérification et prix : `claude-haiku-5-5`, pensée coupée et effort bas (`lib/llm/reglages.ts` ; la pensée compte dans `max_tokens`). Vidéo et assistant : `claude-sonnet-5-5`, pensée adaptative bornée par l'effort (`disabled` y est refusé : 400). Tarifs de `lib/llmUsage.ts` relus sur la page officielle le 28/10/2026 : Haiku 5.5 0,10 $/0,50 $, Sonnet 5.5 2 $/10 $ (lecture de cache ×0,05), Opus 5.5 4 $/20 $. Les variables Vercel `BATCHCHEF_LLM_MODEL*` et `BATCHCHEF_MODELE_ASSISTANT` l'emportent sur le code, mais `lib/llm/modele.ts` écarte toute valeur hors génération 5.5 (défaut du code + `console.warn` « [modele] … ignorée ») : leur valeur n'a pas à être lue. Chaque appel LLM laisse une ligne `[llmUsage] <action> modele=… entree=… sortie=… cache écrit=… lu=…` dans les journaux Vercel : c'est la preuve du modèle réellement appelé et du cache, sans toucher la base.

## LIA, l'assistant (22/10/2026, tâche #278, mission MoKarade/.github#543)

`@mokarade/lia-ui` v0.39.0 (tag, jamais une branche ; v0.12.2 le 23/10/2026 pour avoir la même LIA que le hub (tâche #284), v0.13.0 (tâche #286) : ses 39 silhouettes d'action, v0.14.0 (tâche #288) : parole propre et physique de déplacement, v0.15.0 (tâche #290) : elle répond sur son humeur, analyse tout élément, réagit à l'appui long au tactile, v0.16.0 (tâche #292) : présente tout le temps, montée par `demarrerLia`, puis v0.23.1 (tâche #295) : monde intérieur simulé (douleur, plaisir, confiance), physique de lancer, bonds, « Comment elle va » dans son menu, API inchangée, puis v0.28.0 (tâche #297) : souvenirs sur plusieurs jours, ses nanobots analysent l'élément visé, marche humaine, paquet importable côté serveur, API toujours inchangée, puis v0.37.2 (24/10/2026, re-pin sans code : seuls les 100 nanobots analysent, discussion à côté de l'élément, chat plus grand) ; v0.39.0 (tâche #317, 26/10/2026, re-pin sans code) : `validerEtat` ne retire plus la clé `discussion` de l'état partagé (≤ 20 messages de 600 caractères, 4 000 au total, fermée = sans texte, corps > 16 Ko = 413), donc la discussion de LIA suit Marc d'une app à l'autre ; c'est du texte de Marc, relayé sans être lu, gardé chiffré par MemoryAI (MemoryAI#263) ; v0.34.0 (tâche #302) : option `pause` (v0.31.0), branchée sur la pause générale du hub : `GET /api/lia/pause` de l'app relaie `GET /api/lia/pause` du hub avec la session de l'utilisateur, pause illisible = pause (échec fermé), jamais en pause sur `/login` ; le 423 du hub arrive au navigateur en 423 `paused`, distinct du 503 de panne ; `basculerPause` (le geste du menu) n'est pas branché, la pause s'écrit au hub ; `ask` reçoit un 3e argument `contexte` (humeur, silhouette, regard) que `lib/lia/demarrage.ts` ignore, rien n'est envoyé de plus au hub. La parole propre (`parolePropre`, défaut vrai) parle d'elle seule (heure, humeur, envies), jamais de Marc ni de l'app : aucun texte inventé sur BatchChef. L'état partagé de LIA (humeur, envies, mémoire lente, tâche #304) est celui du hub et de MemoryAI : `demarrerLia` reçoit `etat` (`etatHttp("/api/lia/etat")`, même origine), nourri par `GET|PUT /api/lia/etat` de l'app, derrière le middleware ET `requireSession()`, qui relaie `/api/lia/etat` du hub avec la session de l'utilisateur (aucun jeton d'app) ; corps d'écriture jugé avant tout saut réseau (16 Ko, `validerEtat`), 401/403/429 du hub rendus, tout autre échec en 503 (LIA garde alors son état local), rien sur `/login`. `etat` (optionnel dans la réponse de `ask`) n'est pas transporté par `lib/lia/contrat.ts` : elle suit le curseur et le défilement ; `onSpontane` n'est pas branché ici) est monté HORS du rendu par `demarrerLia` (`@mokarade/lia-ui/boot`), appelé par `web/instrumentation-client.ts` via `web/lib/lia/demarrage.ts` : avant l'hydratation, donc présente même pendant un chargement ou si une page plante. Présente sur TOUTES les pages, `/login` comprise (tâche #299, 24/10/2026) : sur `/login` elle est en mode invité (elle bouge et parle, mais `ask` refuse avant tout réseau et elle dit « indisponible ») ; le mode se relit à chaque question d'après la page courante (`creerAsk`). Plus de `<Lia>` dans le layout (une seule voie). Clic = discussion, clic droit = menu. Route `POST /api/lia/ask` (`web/app/api/lia/ask/route.ts`) : derrière le middleware ET `requireSession()` de `web/lib/lia/session.ts` (BatchChef n'avait pas de `lib/session.ts` ; ses Server Actions gardent `lib/actionsInternes/session.ts`). Elle relaie la question au hub avec `HUB_TOKEN` et lui dit si la session est celle du propriétaire (`AUTHORIZED_EMAIL`). Échec fermé : sans réponse conforme, LIA dit « indisponible ». Réglages communs avec le hub : `demarrerLia` ne reçoit ni `quandMouvementReduit` ni `humeurVisible`, donc animations complètes (défaut du paquet, le menu de LIA mémorise le choix) et pastille d'humeur dessinée par le paquet ; verrou `web/tests/liaReglages.test.ts`. Copie de la référence `app-template`, détail et contrat : `docs/claude/13-lia.md`. `/api/lia/ask` n'est pas `/api/mcp` : elle reste dans le middleware. La route du hub (Hubperso#337) est en production (22/10/2026) ; LIA répond « indisponible » tant que MemoryAI ne répond pas (clé Anthropic de production refusée constatée le 22/10/2026).

## Logo série A (21/10/2026, tâche #269, mission MoKarade/.github#467)

Marc a validé le 21/10/2026 la série de logos A pour toutes les apps. BatchChef : une marmite dont le couvercle sautille, dessin
orange `#FB923C` sur tuile sombre `#0B0D12`, étincelle IA argent `#E6EAF2` qui monte comme la vapeur. Les deux `icon.svg`
(`web/app/icon.svg` pour l'onglet, `web/public/icon.svg`) sont identiques ; les PNG `icone-192`, `icone-512` et `icone-maskable-512`
sont rendus depuis le même dessin (le maskable est plein cadre, dessin réduit pour rester dans la zone sûre). Les noms de fichiers
et le manifeste ne changent pas ; `background_color` et `theme_color` restent `#07090d`. Source du dessin et planche :
https://claude.ai/artifact/VE77ugr9oDtLzUTa53ixaM. À constater en production après le merge : `/icon.svg` contient `#fb923c`.

Icône d'écran d'accueil iPhone (22/10/2026) : `web/app/apple-icon.png` (180 x 180, même dessin que la grande icône) ajouté ; Next.js le publie en `apple-touch-icon`. Avant, iOS n'avait aucune icône dédiée. iOS ne rafraîchit pas une icône déjà posée : retirer l'app de l'écran d'accueil puis la rajouter. La marque du menu (`nav-marque`) est du texte, pas un logo : rien à changer. Le service worker (`sw.js`) ne met aucune icône en cache.

## Merges sans déploiement : mesure du 21/10/2026 et alerte (tâche #203)

Mesuré le 21/10/2026 vers 12 h 40 Z (API Vercel `batchchef-glu8` et API GitHub, pas recopié) : sur les **53 merges** de `master`
du 14/10 à 13 h 09 Z au 21/10 à 01 h 56 Z (#170 à #259), **chacun a un déploiement** : 38 `READY` et 15 `CANCELED` (le saut
volontaire de `build-necessaire.sh` pour un commit de doc seule). Aucun merge muet depuis #169 (14/10, 12 h 23 Z, lockfile), le
dernier connu ; #170 l'a rattrapé 46 minutes plus tard (le script compare au dernier commit déployé).

**Cause : toujours non établie.** Ce qui est exclu par la mesure : `build-necessaire.sh` (son `exit 0` crée un `CANCELED`, #169
touchait `web/package-lock.json` donc devait construire) ; le type de fichier (#119 touchait aussi le lockfile et a été déployé).
Le défaut est intermittent et en amont : l'intégration Git de Vercel n'a créé ni déploiement ni statut pour ce commit. Il manquait une alerte, pas un correctif de notre côté.

**Alerte posée** (`.github/workflows/deploiement-present.yml`, logique `web/scripts/verifier-deploiement.mjs`, test
`web/tests/verifierDeploiement.test.ts`) : après chaque push sur `master`, le workflow cherche le statut « Vercel » du commit
(`success`, `pending`, ou `success` « Canceled by Ignored Build Step » = sain), jusqu'à 10 minutes. Rien trouvé, ou déploiement en
échec : le run devient rouge et le Réacteur (`reacteur.yml`) réveille le Coordinateur, même quand le push vient d'un robot.
Contrôlé sur les vrais commits : #169 (`815d6d6`) sans statut = absent, un commit de doc (`9ca3c80`) = présent « Canceled by Ignored
Build Step », #258 (`93d91b6`) = présent « Deployment has completed ». Rattrapage d'un merge muet : un NOUVEAU push sur `master`, jamais « Redeploy ».

## Contrôles communs et grille de conformité (16/10/2026, tâche #216)

La CI appelle maintenant les contrôles communs de `MoKarade/.github` : `securite-commune` (gitleaks sur les commits de la PR,
OSV-Scanner sur `web/package-lock.json`, CodeQL), `conformite` (la grille de 15 lignes, tableau dans le résumé du job,
`bloquant: false` tant que des lignes attendent leur tâche) et `fumee.yml` (après chaque déploiement de production : santé
et connexion de `https://batchchef.hubperso.com`). Le job `gate` lance aussi `npm run lint` (propre, mesuré). Le risque accepté
`braces` 3.0.3 (dev seulement, GHSA-vfj7-8cjw-p6xm, aucun correctif) est dans `web/osv-scanner.toml`, à réexaminer au
16/01/2027 (même décision que app-template). `web/vercel.json` : `**` et `*` coupés, `master` seule rouverte (voir
`docs/claude/05-deploiement.md`). `BACKLOG.md` est un renvoi vers les issues ; l'ancien est dans `docs/archive/`.

Grille mesurée en local avant la PR (6 vert, 9 rouge) ; chaque ligne rouge restante a sa tâche :

| Ligne | Reste rouge parce que | Tâche |
|---|---|---|
| 6 Sécurité | scan de secrets et protection au push à activer (réglage propriétaire) | #237 (Marc) |
| 7 Versions | vitest 5.0 (monté le 28/10/2026, #236 ; Stryker 10.1.x le pilote, #319) | #236 |
| 9 Surveillance | Sentry branché (dépendance `@sentry/*`, voir plus bas) : la ligne passe au vert ; la preuve attend le DSN de Marc | #220 |
| 10 Base | faux rouge : la grille ne lit pas `scripts/vercel-build.mjs` | MoKarade/.github#112 |
| 12 Socle visuel | faux rouge : la grille ne voit pas le `color-scheme: dark` de `:root` quand `globals.css` commence par `@import "tailwindcss";` | MoKarade/.github#113 |

Socle visuel commun (tâche #219, 16/10/2026) : déjà appliqué, rien à refaire à l'écran. Le socle d'app-template (#39) est repris
de la direction visuelle de BatchChef : mêmes jetons (comparés dans `globals.css`, seuls `--police` et `--police-code` y portent ici d'autres
noms : `--police-titre`, `--police-texte`, `--police-chiffres`), mêmes règles verrouillées par `web/tests/theme.test.ts` (9 tests verts :
couleurs seulement dans `globals.css`, aucune classe de palette, WCAG, cibles et champs). Seul écart voulu : BatchChef reste en thème sombre
seul (décision de Marc, 26/09/2026) là où le socle suit le système ; la grille accepte ce choix (`MoKarade/.github#98`).

Sentry (tâche #220, 16/10/2026) : les erreurs serveur (`web/instrumentation.ts`) et navigateur (`web/instrumentation-client.ts`, `web/app/global-error.tsx`)
partent à Sentry, sans donnée personnelle (`web/lib/sentryConfig.ts` : ni IP, ni cookies, ni en-têtes, ni corps, ni chaîne de requête, ni utilisateur ; verrou
`web/tests/sentryConfig.test.ts`). Éteint sans `SENTRY_DSN` : le code est en ligne, rien ne part encore. La CSP (`connect-src` de `web/next.config.ts`) admet
les hôtes d'ingestion Sentry, sans quoi le navigateur bloquerait chaque envoi. Pour allumer : créer le projet Sentry de BatchChef, poser `SENTRY_DSN` dans
Vercel ET comme secret du dépôt, redéployer, puis lancer le workflow « Essai Sentry » (Actions) : il échoue si Sentry ne répond pas 2xx. Les messages d'erreur
partent tels quels (ils peuvent citer un nom de recette ou une adresse présente dans le texte de l'erreur) ; rien d'autre n'est lu.

La fumée contrôle aussi `/api/hub/summary` avec le secret `HUB_TOKEN` du dépôt (posé par Marc le 16/10/2026, tâche #238) ; première preuve : le prochain déploiement de production.

## Test qui échouait au hasard : trouvé (16/10/2026, tâche #204)

Le coupable : `tests/sante.test.ts > GET /api/sante — base réelle en mémoire (PGlite) > 200 { ok: true }, no-store`. Cause : le
démarrage de PGlite (WebAssembly) dépasse le délai par défaut de 5 s quand la machine est chargée. Reproduit à chaque passe sur
un seul cœur (`taskset -c 0 npx vitest run` : 1 échec sur 970, 2 passes sur 2) ; corrigé par `testTimeout: 30_000` et
`hookTimeout: 60_000` dans `web/vitest.config.ts` : 2 passes sur un cœur, puis 10 passes consécutives en machine libre, toutes à
970/970. Un nouveau test qui crée une base PGlite n'a rien à régler.

## Migrations vérifiées au déploiement (16/10/2026, tâche #213)

`vercel-build` (production seulement) lance maintenant `db:verifier-migrations` juste après `db:migrate` : le build s'arrête si la
dernière migration du dépôt n'est pas dans `drizzle.__drizzle_migrations`. Détail : `docs/claude/05-deploiement.md`. Constat
du journal de build du déploiement `dpl_H2XKnvfDiUJosqTkDQrL8Ld3FtJf` (READY, commit `1364cd0`) : `drizzle-kit migrate` a bien
annoncé « migrations applied successfully » avec le pilote Neon, mais sans lister ce qui avait été appliqué ; c'est ce que la
vérification ajoute.

## Commande d'épicerie, jalon A — liste par rayon (30/09/2026)

Spec `spec-batchchef-commande-epicerie.md` (validée par Marc le 30/09), jalon A sur deux.
Sur `/courses/[id]`, dans le dépliant « Outils de la liste » : un bloc **« Préparer une
commande »** montre le restant à acheter regroupé par rayon, et un bouton **« Copier la liste
par rayon »** le copie (un rayon par paragraphe) pour le recopier dans une commande en ligne.

- **Aucun rayon n'existe dans les données** (`ingredient_master.category` NULL partout dans le
  seed V3) : le rayon est DÉRIVÉ du canonical par une table de mots-clés fermée
  (`web/lib/rayons.ts`), en mot entier via `comparable()`, première règle gagnante, rien en
  base. Ce qui n'est reconnu nulle part va dans « Autres » ; l'écran dit que les rayons sont
  approximatifs. Mesure du 30/09 : 192 des 200 canonicals les plus fréquents rangés hors
  « Autres » (96 %), cliquet dans `tests/rayons.test.ts`.
- Quantités brutes (g, ml, unités), aucun format d'emballage, aucun prix dans le texte.
- `ligneArticle` (`web/lib/listeParRayon.ts`) est désormais LE formatage de ligne : le partage
  Keep (`buildText`) l'utilise aussi, comportement inchangé (`tests/shareList.test.ts` intact).
- Un mauvais rangement se corrige dans la table `REGLES` de `lib/rayons.ts` (ordre = priorité),
  avec un cas ajouté aux pièges de `tests/rayons.test.ts`.
- Jalon B (liens de recherche par épicier, tâche #193) : `lib/epiciers.ts` (5 gabarits d'URL de
  recherche, `lienRecherche` encode le terme) et un sélecteur « Chercher chez » dans
  `components/CommandeEpicerie.tsx`, un lien « Chercher » par article. Les 5 sites refusent les robots
  (HTTP 403 le 16/10/2026) : aucune session ne peut ouvrir un gabarit. Marc les a ouverts dans son
  navigateur le 19/10/2026 : Maxi, Metro, Super C et Walmart donnent des résultats ; l'ancien gabarit IGA
  (`iga.net/fr/search`) donnait une 404, remplacé par `iga.ca/?query={q}&tab=products` (adresse relevée par
  Marc, tâche #254). L'ordre d'affichage reste celui de la spec, à trancher par Marc.

## État au 25/09/2026 — à lire en premier

> Mesuré le 25/09/2026 à 13 h 44 Z (API Vercel, `git`, API GitHub), pas recopié. Tout ce qui
> suit est DATÉ : un chiffre au présent rote, et ce document l'a déjà vécu.

### ⚠️ La production ÉTAIT en retard sur `master` — rattrapée le 25/09 à 13 h 53 Z

| | commit | quand |
|---|---|---|
| Pointe de `master` avant ce rapport | `5474a1e` (#124) | 24/09, 17 h 11 Z |
| Ce que la production servait à 13 h 44 Z | `eb7bdc3` (#119) | construit le 24/09, 11 h 07 Z |
| **Ce qu'elle sert depuis** | **`5ad27ab` (#125) = `master`** | `READY` le 25/09 vers 13 h 53 Z |

**Le rattrapage s'est fait tout seul, avec un commit de DOCUMENTATION** (#125, ce rapport).
Attendu : un `CANCELED`. Observé : un build complet, `READY`. Raison : `build-necessaire.sh`
ne compare pas au commit d'avant mais au **dernier commit DÉPLOYÉ**
(`VERCEL_GIT_PREVIOUS_SHA`), et le diff `eb7bdc3..5ad27ab` portait les lockfiles des quatre
merges muets. Conséquence utile : **un trou de `DEPLOI-MUET` se referme au push suivant sur
`master`, quel qu'il soit.** Ce qui reste inconnu, c'est pourquoi le trou se creuse.

Ce qui suit décrit le trou tel qu'il était mesuré avant le rattrapage.

Entre les deux, cinq merges. `#121` ne touche que `web/tests/` : son déploiement `CANCELED`
est le saut volontaire de `build-necessaire.sh` — sain. **Les quatre autres n'ont produit
AUCUN déploiement, pas même un `CANCELED`** : `#120` (drizzle-orm 0.45.2 → 0.45.3 et
drizzle-kit), `#123` (qs), `#122` (fast-uri), `#124` (hono, développement seulement).

C'est `DEPLOI-MUET` (backlog) qui revient. L'impact d'aujourd'hui est faible — des correctifs
de dépendances — mais le mécanisme est celui qui laisserait une FONCTIONNALITÉ mergée hors
ligne sans que rien ne soit rouge nulle part. Ce qui est établi :

- Le projet n'est **pas muet en continu** : entre le 15 et le 24/09, `#111`, `#115`, `#117`,
  `#118` et `#119` ont bien été déployés `READY`.
- Le silence commence **entre 15 h 38 Z** (`#121`, déploiement créé) **et 15 h 43 Z** (`#120`,
  rien) le 24/09. À 17 h 09 Z, les préversions des branches Dependabot se créent encore — mais
  les merges sur `master` de la minute suivante, non.
- Ce n'est pas le type de fichier : `#119`, déployé, touchait `package.json` et le lockfile
  comme `#120`, qui ne l'a pas été.
- Les réglages du projet ont été modifiés le 24/09 vers 17 h 29 Z (il porte désormais
  `nodeVersion: 24.x`) — APRÈS le début du silence, donc pas sa cause au premier ordre.
  `framework: null` et l'absence de domaine personnalisé dans l'API sont toujours là.
- **Cause non établie d'ici** : le tableau de bord Vercel et `*.hubperso.com` sont hors de
  portée de la session.

### Ce qui a changé depuis le 15/09 — 22 commits d'autres sessions et de Dependabot

**Fonctionnalités**
- `HUB-BATCHS-30J` (#99) — la carte du hub dit « Batchs (30 jours) » : l'activité sur trente
  jours GLISSANTS, pas le mois civil (qui retomberait à zéro chaque 1er du mois).
- `PWA-ANDROID` (#102) — une vraie icône `maskable` (la marmite n'est plus rognée par le masque
  d'Android), `id: "/"` pour que l'installation ne se dédouble pas, `launch_handler`.

**Sécurité**
- #101 — le jeton GitHub n'est plus lisible pendant tout le run de CI, et `npm ci` tourne en
  `--ignore-scripts`.
- #103, #111 — gitleaks et SonarCloud en CI.

**Plateforme** (tout a monté d'une majeure en deux jours)
- Next **15.5.25 → 16.3.5** (#109), zod **3 → 4.6.5** (#115), Node **24** partout (`.nvmrc`,
  Vercel `24.x`, #110), eslint-config-next 16 en flat config (#111), `@types/node` 24 (#117).
- vitest monté en 5 (#118) puis **redescendu en ~4.1** (#119) : l'outil de mutation (Stryker)
  ne sait pas encore piloter vitest 5 et rendait un score faux (5,2 % au lieu de 40,6 %).
- Contrat du hub re-pinné sur **`v1.3.1`** (#110 — `dist/` commité, requis sous npm 11), et
  Dependabot ne le déplace plus (#116).
- Plancher `drizzle-orm ≥ 0.45.2` : le test vérifie désormais la BORNE BASSE de la plage, pas
  son texte exact — il refusait une montée comme une descente (#121).

**Processus**
- **Fusion automatique** (#105, #110, puis kit de l'Atelier : `armement-auto-merge.yml`,
  `auto-merge.yml`, `COPIES.md`) : toute PR non brouillon — Dependabot compris — part en squash dès
  que les contrôles obligatoires de `master` sont verts, sauf chemins sensibles (voir
  `.github/auto-merge.json`). Une PR en BROUILLON n'est jamais fusionnée.
- **Portes qualité de l'Atelier** (#103, #117) : `npm run portes` compare lint, couverture,
  code mort et architecture à `web/qualite/seuils.json` (cliquet : rien ne recule) ; mutation
  hebdomadaire en CI. Mesures de départ (23/09) : 562 tests, mutation 40,6 %.

### Ce que cette session a livré (14-15/09)

| PR | lot | en une ligne |
|---|---|---|
| #86 | `SEM-02` · `SEC-01` | la semaine proposée (3 plats + 1 dessert) ; une RCE non authentifiée fermée en passant |
| #87, #90 | `SEM-01` | le type de plat — sept familles estimées, corrigibles ; la couverture se COMPTE |
| #91 | `SEM-05` | prix, temps et difficulté (1 à 5 étoiles, coupes = quintiles mesurés) |
| #92 | `SEM-03` | changer la semaine en parlant à l'assistant ; re-tirer les quatre d'un coup |
| #93 | `ING-10` | un seul arrondi, après la multiplication — 17 231 lignes réécrites au déploiement |
| #94, #95 | doublon | le bouton existait ; Marc a supprimé l'exemplaire en trop (survivant : `#8`) |
| #97 | `CAT-H` | le prompt et l'outil MCP n'annoncent plus 10 188 recettes quand on en sert 10 170 |
| #96, #98 | docs | HANDOVER remis à l'état réel ; un compte qui avait roté dans l'heure, retiré |

### Ce qui reste ouvert

- 🔴 `DEPLOI-MUET` — ci-dessus. C'est la seule chose qui compte avant tout nouveau lot.
- Deux points PWA que seul un vrai téléphone tranche (backlog) : un partage Instagram
  RÉUTILISE désormais la fenêtre ouverte (`launch_handler`), et le lien du hub vers l'app
  installée dépend de Chrome.
- `ING-09` (26 lignes, 0,03 %) — à rouvrir seulement si l'une gêne en vrai.
- Deux idées NON arbitrées — à proposer, jamais à prendre seul. (La troisième,
  l'historique, est devenue `HIST-01` sur décision de Marc le 29/09.)
- **`HIST-01` (29/09)** — `/historique` (lien depuis `/batchs`) : la trace naît à « Terminer
  le batch », dans le MÊME `db.batch` que le statut, et un recul l'efface. Table
  `meal_history` (migration `0017`, création seule). À faire après le merge : vérifier le
  déploiement `READY`, que la table existe, puis terminer / reculer / supprimer un vrai batch
  (C1, C3, C4). ⚠️ Ne pas tester « Terminer » sur une préversion : la table n'y existe pas
  avant le merge, et le changement de statut échouerait (voulu : pas de trace manquante).
- **Le chantier SEMAINE n'a jamais été vu servir d'ici** : aucune de ses surfaces n'a été
  exercée par cette session contre la production. Le premier usage reste le premier test.

## Où en est l'app

Le cycle en place et déployé : **importer une recette → composer un batch → faire
l'épicerie → cuisiner**. Il s'arrête là, volontairement (décision de Marc, 17/08 — voir
« Ce qui vient d'être livré »).

| Domaine | État |
|---|---|
| Import par URL | En service (parse LLM + vérification, Zod) |
| Import vidéo (reel) | En service — enregistrement d'écran partagé depuis Android, images extraites DANS le navigateur, transcription audio en appoint |
| Catalogue | **10 170 recettes** servies (le seed en porte 10 188 ; `CAT-E` en a retiré 18), cherchable, paginé. L'écran affiche un compte DÉRIVÉ, jamais un nombre écrit |
| Batchs + liste d'épicerie | En service, prix estimés (couverture 100 %) |
| Export Google Tasks | En service |
| **Assistant** | **Neuf (19/08)** — `/assistant`, Claude fouille la base par outils ; les recettes citées deviennent des boutons qui ouvrent la fiche PAR-DESSUS la page (depuis le 28/10 : dans l'atelier de LIA, #346). ⚠️ Éteint si `ANTHROPIC_API_KEY` absente (dit à l'écran, pas une panne) |
| **Proposition de la semaine** | **Neuve (14/09)** — carte « Ta semaine » sur l'accueil : **3 plats + 1 dessert**, remplaçables un à un, et un bouton qui monte le batch avec sa liste d'épicerie. Fabriquée à l'ouverture de l'app, pas par un cron |
| **Semaine par l'assistant** | **Neuf (14/09)** — « mets-moi quelque chose avec du poulet à la place du troisième » : l'assistant lit ta semaine, propose, et un bouton dans le chat applique. Plus un « Propose-moi une autre semaine » sur la carte, derrière une confirmation |
| **Prix, temps et difficulté** | **Neuf (14/09)** — la carte « Ta semaine » annonce le temps total et le prix estimé de l'épicerie ; chaque recette porte une note de difficulté en étoiles (1 à 5), partout où elle s'affiche |
| **Type de plat** | **Neuf (14/09)** — sept familles déduites du titre et des ingrédients (91,4 % de couverture, 54/56 sur un échantillon jugé). Filtre dans le catalogue, étiquette « estimé » sur les fiches, correction manuelle qui survit au recalcul |
| Widget hub | `GET /api/hub/summary`, contrat `@mokarade/hub-contract` **v1.6.0** (depuis le 28/10/2026 ; Zod 4 depuis v1.5.0, le 16/10/2026) — la carte montre la semaine et « Batchs (30 jours) » (#99) |
| Installable (Android) | PWA, icône `maskable` dédiée (#102) ; c'est l'app INSTALLÉE qui reçoit les vidéos partagées |
| **Serveur MCP** | **Neuf (19/08)** — `POST /api/mcp`, 7 outils (4 lecture, 3 écriture). **BRANCHÉ ET VÉRIFIÉ EN USAGE RÉEL** le 19/08 : Marc a connecté le connecteur claude.ai (OAuth 2.1, ADR-0002), et les outils rendent ses vraies données. Claude Code reste possible par jeton direct. |
| Accès | **Deux étages** : le propriétaire (`AUTHORIZED_EMAIL`, vérifié sans réseau), puis toute personne à qui le hub a donné l'accès (`lib/accesHub.ts` → `POST /api/acces`). Cette ligne disait « mono-adresse » — faux depuis l'étape 2 |
| Analytics | `@vercel/analytics` posé. ⚠️ **Ne collecte rien tant que Web Analytics n'est pas activé dans le tableau de bord Vercel** — geste de Marc |

Production : `batchchef.hubperso.com` (Vercel, projet `batchchef-glu8`).
Gate : `typecheck` · `lint` · `test` · `build`, plus les **portes qualité** (`npm run portes`).
Node **24**, Next **16**, zod **4**. Le nombre de tests ne s'écrit pas ici — il se lit dans la CI
(562 au 23/09, mesuré par #103).

## Le doublon de la bibliothèque perso (15/09/2026)

Marc a supprimé lui-même l'exemplaire en trop de « Fusilli à la crème champignons et poulet »
depuis la fiche : **la bibliothèque n'a plus aucun doublon**.
⚠️ Le COMPTE de recettes n'est pas écrit ici, et c'est délibéré — il bouge dès que Marc en
ajoute une. Écrit « 13 » à 13 h, il valait 14 au build de 13 h 36 (`#16 Gratin végétarien`).
Le compte se lit dans le log de build (`[ingr] bibliothèque : … sur N recettes`).
⚠️ **L'exemplaire conservé est `mes-recettes #8`** — c'est #1 qui est parti : le bouton
supprime la recette dont la fiche est AFFICHÉE, et la liste ne montre pas les ids. Les deux
étaient identiques au caractère près, donc seul l'id à citer change.

Aucun code n'a été écrit : le bouton « Supprimer » existait déjà. Les deux alternatives
(une suppression dans le script de build, un outil MCP de suppression) ont été écartées par
Marc et restent nommées au backlog.

## Ce qui vient d'être livré (14/09/2026)

- **`ING-10` — le double arrondi.** « 49,98 g de farine », « 1,98 pièces de blanc d'oeuf »,
  « 4,02 tranches de jambon » : le catalogue stockait une quantité par portion **déjà
  arrondie**, que les deux écrivains multipliaient ensuite par le nombre de portions —
  l'erreur d'arrondi était donc multipliée elle aussi. Un seul arrondi désormais, et il vient
  après la multiplication.

  Mesuré sur le corpus : **17 788 lignes sur 73 542 chiffrées (24,2 %)** changent de valeur,
  pire écart absolu **0,20**.

  ⚠️ **Ce qui se répare n'est pas un chiffre faux, c'est la confiance.** La valeur était juste
  à une fraction de pour cent près ; mais « 4,02 tranches » se lit comme une erreur et fait
  douter du reste de la fiche.

  ⚠️ **Au prochain déploiement, la passe de réparation réécrit ces ~17 800 lignes** en
  production. Idempotent et non destructif — c'est la correction voulue — mais c'est une
  écriture de masse, et le log la comptera.

- **`SEM-03` — changer la semaine en parlant.** L'assistant voit ta semaine (`lire_semaine`),
  propose un remplacement par un marqueur qui devient un **bouton**, et c'est toi qui cliques.
  La carte dit ce qu'elle remplace, et **avertit quand elle casse la composition** « trois
  plats et un dessert » — ton clic vaut demande explicite, il ne peut la valoir que si tu sais
  ce que tu demandes.

  ⚠️ **L'atelier vit sur `/assistant`, la carte sur l'accueil** : après un clic tu ne verras
  rien bouger. Le bouton devient « X est posée à la place N de ta semaine » — c'est la seule
  confirmation que tu auras.

  ⚠️ **L'outil LIT, il ne fabrique jamais la semaine.** `semaineCourante` la crée quand elle
  manque : appelée depuis un outil, elle la fabriquerait au détour d'une question et effacerait
  la précédente.

- **Regénérer la semaine entière** (demandé en cours de lot). Bouton « Propose-moi une autre
  semaine », derrière une **confirmation** : les quatre partent et ne reviennent pas. La graine
  change à chaque appel, sinon le tirage déterministe rendrait les quatre mêmes recettes.

- **`SEM-05` — prix, temps et difficulté.** La carte « Ta semaine » porte maintenant trois
  chiffres : le **temps total** de cuisine, le **prix estimé** de l'épicerie, et une note de
  **difficulté en étoiles** sur chaque recette — reprise partout où une recette s'affiche
  (accueil, bibliothèque, catalogue, fiches).

  Mesuré sur les 10 188 : **10 185 recettes notées**, distribution 19,9 / 19,8 / 20,2 / 20,0 /
  20,0 % sur les cinq niveaux. Trois recettes n'ont pas assez de signaux et disent
  « difficulté non estimée ».

  ⚠️ **L'échelle est RELATIVE au catalogue.** Les coupes sont les quintiles mesurés du score
  composite, pas des seuils choisis : trois signaux corrélés et moyennés font une cloche, et
  des seuils « ronds » auraient écrasé tout le monde sur 2-3-4. Une étoile veut donc dire
  « parmi les plus simples du catalogue », pas « facile dans l'absolu ».

  ⚠️ **Ce qui est mesuré est l'EFFORT, pas la TECHNIQUE** — ingrédients, étapes, durée. Une
  omelette roulée sortira « très simple », et aucun signal du corpus ne dit le contraire.

  ⚠️ **Le prix passe par les mêmes fonctions que le batch**, sur les mêmes portions : sans ça,
  Marc verrait un chiffre avant de monter le batch et un autre après, pour les mêmes courses.
  Il est calculé une fois par composition et mémorisé ; **remplacer une recette le recalcule**
  (sinon le prix décrirait une semaine qui n'existe plus). Un appel d'estimation par semaine,
  plus un par remplacement.

  ⚠️ **Une recette sans durée n'est pas comptée zéro** : elle sort du total et son titre est
  nommé sous la ligne. 224 recettes sur 10 188 n'ont aucune durée dans la source.

- **Correctif du jour même — la couverture annoncée par la passe de classement était FAUSSE.**
  Le premier build de production a imprimé « 10 170 portent un type » (100 %) là où la
  couverture réelle est 9 294 (91,4 %), le chiffre publié partout ailleurs dans cette même
  livraison. Le compte était **déduit** (`total − écritures nulles`) au lieu d'être compté :
  une recette déjà à `null` qui reste `null` n'est jamais écrite, donc elle échappait à la
  soustraction tout en étant exactement le cas à retrancher.

  Corrigé en supprimant la dérivation (un compteur sur le verdict), et la couverture se dit
  désormais **aussi** quand rien ne bouge — sans ça, la passe étant idempotente, le chiffre
  corrigé n'aurait plus jamais été imprimé. Verrou : tripwire de surface scopé à
  `classerCatalogue` dans `tests/deploiement.test.ts`, deux mutations prouvées.
  ⚠️ Les chiffres de la doc, eux, étaient justes : seul le log mentait.

- **`SEM-01` — le type de plat.** Sept familles (plat, entrée et apéro, accompagnement, soupe,
  salade, dessert, sauce et condiment), déduites du titre et des ingrédients. **91,4 % du
  catalogue est classé** ; les 8,6 % restants disent « non déterminé » plutôt que de tomber
  dans la famille la plus probable. Exactitude **54 sur 56** sur un échantillon stratifié jugé
  à la main — les deux erreurs sont nommées dans `docs/archive/BACKLOG-avant-2026-10-16.md`, et 56 est un petit échantillon.

  Ce qui en découle à l'écran : un filtre par type dans le catalogue, une étiquette sur chaque
  fiche (marquée « estimé » tant que Marc ne l'a pas corrigée), et la semaine qui passe à
  **3 plats + 1 dessert**.

  ⚠️ **La correction de Marc est indexée par `source_url`**, pas par l'id du catalogue :
  `npm run catalog:import` change les ids, jamais les URL. Une correction indexée par id
  disparaîtrait à la première réimportation, sans erreur.

  ⚠️ **Le type est une ESTIMATION, et l'app le dit.** C'est « no fake data » appliqué à un
  classement : une estimation présentée comme une donnée est le défaut que le reste de l'app
  s'interdit.

- **`SEM-02` — la proposition de la semaine.** Marc ouvre l'app, il voit quatre recettes à
  cuisiner. Il peut en remplacer n'importe laquelle, et un bouton monte le batch complet avec
  sa liste d'épicerie.

  Ce qui fonde la sélection, et **rien d'autre** : les temps de préparation et de cuisson
  (réels, renseignés sur les 10 188 recettes) et la variété des ingrédients. Aucun « facile »,
  aucun « végétarien » — le classement n'existe pas encore (`SEM-01`), et l'inventer serait le
  contraire de ce que l'app promet.

  | où | quoi |
  |---|---|
  | `lib/semaine.ts` | la DÉCISION, pure et testée : semaine ISO dans le fuseau de Marc, tirage déterministe, variété, « au moins une courte » |
  | `lib/semaineDb.ts` | l'I/O : présélection SQL déterministe, écriture gardée par l'unicité `(semaine, position)` |
  | `components/SemaineProposee.tsx` | la carte, sur l'accueil |
  | table `week_picks` | migration `0013`, purement additive |

  ⚠️ **La semaine se fabrique à l'OUVERTURE**, pas par un cron : le plan Vercel gratuit
  n'accepte que des crons quotidiens, et une proposition que personne ne regarde n'a pas
  besoin d'exister.

  ⚠️ **L'anti-répétition s'appuie sur les BATCHS, pas sur les propositions passées** — Marc a
  écarté l'historique. C'est plus juste (on évite ce qu'il a CUISINÉ, pas ce qu'on lui a
  MONTRÉ), mais **inerte tant qu'il n'a aucun batch**, et il n'en a aucun aujourd'hui.

  ⚠️ **Pas encore vu dans un navigateur.** Cette session n'a pas d'accès à la production : la
  carte est prouvée par les tests et le build, pas par un écran. À regarder au premier
  chargement.

  ⚠️ **La migration `0013` n'atteindra la base qu'au MERGE**, pas avant : `web/vercel.json`
  porte `git.deploymentEnabled: { "claude/*": false }`, donc aucune préversion n'est
  construite pour ces branches — vérifié, zéro déploiement créé pour le push de la PR #86.
  C'est l'inverse de ce que le `CLAUDE.md` affirmait ; corrigé dans la même PR. Après le
  merge, vérifier qu'un déploiement de production a bien été CRÉÉ (les deux merges
  précédents sont `CANCELED` — normal, l'`ignoreCommand` saute les commits de docs seules,
  mais celui-ci touche du code et doit donc construire).

## Le chantier catalogue (19/08/2026, premier lot)

- **`CAT-A` — le catalogue annonce enfin son vrai nombre de portions.** Les 10 188 recettes
  disaient « pour 1 portion » ; 10 049 portent maintenant leur rendement réel, et leurs
  quantités sont celles de la recette entière (« 320 g de fusilli », plus « 80 g »).
  ⚠️ `servings` et `qty` partent dans la MÊME transaction (`db.batch`) : séparées, une
  coupure laisserait la recette fausse d'un facteur R sans qu'aucun écran ne le dise.
  Aucun batch existant ne bouge — vérifié sur le batch #13, liste identique au gramme.
  Le chantier catalogue complet est planifié dans `docs/archive/BACKLOG-avant-2026-10-16.md` (`CAT-B` à `CAT-G`).

- **`ING-08` — les quantités reconstruites depuis le texte source.** 13 448 lignes
  corrigées. Le défaut le plus coûteux : une fraction en tête était lue « 1 », donc
  « 1/2 kg de viande hachée » faisait acheter **1 kg**. Vérifié par un test de corpus sur
  les 87 444 lignes, 3 000 batchs simulés, et la preuve par l'usage sur le batch #13
  (20 articles sur 20 conformes à leur source). Reste 26 lignes irréductibles, nommées une
  par une dans `docs/archive/BACKLOG-avant-2026-10-16.md` (`ING-09`).
- ⚠️ **Le taux de 99,85 % annoncé par `ING-06` ne portait que sur le nom et l'unité.** La
  colonne quantité n'était jugée que par l'absurde. À relire avant de citer ce chiffre.

## Ce qui a été livré avant (17/08/2026)

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

## Le serveur MCP et son OAuth (19/08/2026, second lot)
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

**Au 25/09 : `DEPLOI-MUET` d'abord** (voir « État au 25/09 »). Le rattrapage fiable n'est PAS
un Redeploy (il rejoue le commit d'un déploiement EXISTANT — `docs/claude/05-deploiement.md`, ancien §6 du `CLAUDE.md`) : c'est un
nouveau push sur `master` qui touche un fichier HORS exemptions, puis la vérification que son
déploiement EXISTE. La cause, elle, se cherche dans le tableau de bord Vercel.

Pour le reste, **rien n'est engagé.** Le chantier SEMAINE est fini (`SEM-01`, `SEM-02`,
`SEM-03`, `SEM-05`, livrés le 14/09) et `ING-10` avec. Ce qui reste ouvert au backlog n'est
PAS une file de travail :

- `HUB-RENDU` — rien à faire ICI : c'est le lot 2 du hub. L'entrée existe pour que
  « publié » ne se lise pas « affiché ».
- `ING-09` — les 26 lignes irréductibles du catalogue (0,03 %), chacune mesurée et nommée.
  **À rouvrir seulement si l'une gêne Marc en vrai**, pas parce qu'elle traîne.
- Trois idées NON arbitrées (unité inconnue comptée en pièces, historique de ce qui est
  mangé, budget confronté au réel) — à proposer avant de coder, jamais à prendre seul.

⚠️ **Ce qui manque n'est pas du code, c'est de l'USAGE.** Le chantier SEMAINE a été livré en
une journée et **aucune de ses quatre surfaces n'a servi en vrai** : la carte « Ta semaine »,
le remplacement par le chat, le re-tirage complet, le prix hebdomadaire. Le premier vrai
usage est le premier vrai test — et il dira ce que la mesure ne dit pas (les quatre recettes
tirées sont-elles cuisinables ensemble ? le prix est-il crédible ? les étoiles
correspondent-elles à l'effort ressenti ?).

Le MCP est branché et en service ; `ING-03`, `ING-04`, `ING-05` et `ING-10` sont livrés.

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

- ~~**Tableau de bord Vercel → `batchchef-glu8`** : comprendre pourquoi des pushs sur `master`
  ne créent aucun déploiement (`DEPLOI-MUET`).~~ Plus un geste de Marc (21/10/2026, tâche #203) : les
  déploiements et les statuts de commit se lisent avec l'API Vercel et l'API GitHub, et une alerte rouge signale
  désormais un merge sans déploiement (voir la section en tête).
- Activer **Web Analytics** dans le tableau de bord Vercel (sinon la dépendance ne mesure rien).
- Le client MCP doit viser **`https://batchchef.hubperso.com/api/mcp`** — jamais une URL
  `*.vercel.app` : la protection Vercel du projet est en `all_except_custom_domains`, donc
  celles-là répondent 302 vers la page de connexion Vercel avant que l'app ne tourne.
- ~~Poser `MCP_TOKEN`~~ — **fait le 19/08**, connecteur branché et vérifié en usage réel.
- `GROQ_API_KEY` est posée (transcription audio active).
