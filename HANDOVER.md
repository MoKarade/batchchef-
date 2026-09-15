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
| **Proposition de la semaine** | **Neuve (14/09)** — carte « Ta semaine » sur l'accueil : **3 plats + 1 dessert**, remplaçables un à un, et un bouton qui monte le batch avec sa liste d'épicerie. Fabriquée à l'ouverture de l'app, pas par un cron |
| **Semaine par l'assistant** | **Neuf (14/09)** — « mets-moi quelque chose avec du poulet à la place du troisième » : l'assistant lit ta semaine, propose, et un bouton dans le chat applique. Plus un « Propose-moi une autre semaine » sur la carte, derrière une confirmation |
| **Prix, temps et difficulté** | **Neuf (14/09)** — la carte « Ta semaine » annonce le temps total et le prix estimé de l'épicerie ; chaque recette porte une note de difficulté en étoiles (1 à 5), partout où elle s'affiche |
| **Type de plat** | **Neuf (14/09)** — sept familles déduites du titre et des ingrédients (91,4 % de couverture, 54/56 sur un échantillon jugé). Filtre dans le catalogue, étiquette « estimé » sur les fiches, correction manuelle qui survit au recalcul |
| Widget hub | `GET /api/hub/summary`, contrat `@mokarade/hub-contract` |
| **Serveur MCP** | **Neuf (19/08)** — `POST /api/mcp`, 7 outils (4 lecture, 3 écriture). **BRANCHÉ ET VÉRIFIÉ EN USAGE RÉEL** le 19/08 : Marc a connecté le connecteur claude.ai (OAuth 2.1, ADR-0002), et les outils rendent ses vraies données. Claude Code reste possible par jeton direct. |
| Accès | Google mono-adresse + interrogation du hub (`lib/accesHub.ts`) |
| Analytics | `@vercel/analytics` posé. ⚠️ **Ne collecte rien tant que Web Analytics n'est pas activé dans le tableau de bord Vercel** — geste de Marc |

Production : `batchchef.hubperso.com` (Vercel, projet `batchchef-glu8`).
Gate : `typecheck` · `lint` · `test` · `build`. **552 tests**, 38 fichiers (14/09/2026).

## Le doublon de la bibliothèque perso (15/09/2026)

Marc a supprimé lui-même l'exemplaire en trop de « Fusilli à la crème champignons et poulet »
depuis la fiche. La bibliothèque compte **13 recettes** et n'a plus aucun doublon.
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

  ⚠️ **Le chat vit sur `/assistant`, la carte sur l'accueil** : après un clic tu ne verras
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
  à la main — les deux erreurs sont nommées dans `BACKLOG.md`, et 56 est un petit échantillon.

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
  Le chantier catalogue complet est planifié dans `BACKLOG.md` (`CAT-B` à `CAT-G`).

- **`ING-08` — les quantités reconstruites depuis le texte source.** 13 448 lignes
  corrigées. Le défaut le plus coûteux : une fraction en tête était lue « 1 », donc
  « 1/2 kg de viande hachée » faisait acheter **1 kg**. Vérifié par un test de corpus sur
  les 87 444 lignes, 3 000 batchs simulés, et la preuve par l'usage sur le batch #13
  (20 articles sur 20 conformes à leur source). Reste 26 lignes irréductibles, nommées une
  par une dans `BACKLOG.md` (`ING-09`).
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

**Rien n'est engagé.** Le chantier SEMAINE est fini (`SEM-01`, `SEM-02`, `SEM-03`, `SEM-05`,
livrés le 14/09) et `ING-10` avec. Ce qui reste ouvert au backlog n'est PAS une file de
travail :

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

- Activer **Web Analytics** dans le tableau de bord Vercel (sinon la dépendance ne mesure rien).
- Le client MCP doit viser **`https://batchchef.hubperso.com/api/mcp`** — jamais une URL
  `*.vercel.app` : la protection Vercel du projet est en `all_except_custom_domains`, donc
  celles-là répondent 302 vers la page de connexion Vercel avant que l'app ne tourne.
- ~~Poser `MCP_TOKEN`~~ — **fait le 19/08**, connecteur branché et vérifié en usage réel.
- `GROQ_API_KEY` est posée (transcription audio active).
