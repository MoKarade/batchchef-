# BACKLOG — BatchChef

> Convention de l'écosystème (FinanceAI, DriveAI, JobAI) : **chaque tâche porte une case**
> `- [ ]`. Une note sans travail à faire n'est pas une tâche — elle va dans un ADR ou dans
> `docs/LESSONS.md`. Un item fini se coche **au merge**, dans la même PR que le code.
>
> ⚠️ Un item peut être **périmé** : vérifier l'état réel avant de coder.

## En cours / décidé, pas encore livré

### Chantier HUB (14/09) — ce que la carte BatchChef dit du hub

- [x] **`HUB-SEM` — la carte montre enfin ce qu'il y a à faire.** Livré le 14/09. Contrat
  re-pinné sur `v1.3.0`, puis : `dataAsOf` (le dernier geste de Marc — le plus récent entre la
  création d'un batch et la dernière case d'épicerie cochée) ; `primary` qui **suit** ce qu'il
  y a à faire (les courses tant qu'il en reste, l'état de la cuisine sinon — jamais
  « Recettes », dix mille et des qui ne bougent pas) ; le NOM du batch en cours en alerte
  d'information ; et un bloc `details` avec la proposition de la semaine et l'épicerie.
  6 mutations jouées, 6 attrapées.
  ⚠️ **Aucun `expectedMaxAgeSec`, exprès** — voir le `CLAUDE.md` §7. BatchChef n'a pas de
  moteur : un seuil ferait crier « figée » à chaque semaine où Marc a mangé dehors.
  ⚠️ **Le hub LIT la semaine** (`lireSemaine`, exportée pour ça), jamais `semaineCourante`
  qui la FABRIQUE : un GET du hub ne doit rien écrire, et son `delete … where semaine <> …`
  effacerait la précédente.
  ⚠️ **Découvert en écrivant le test des bornes, pas en production** : deux titres partageant
  leurs 37 premiers caractères produisaient deux libellés identiques, que le contrat REFUSE —
  `validateSummary` jetait à l'émission et TOUT le summary basculait en `status: "error"`. La
  carte entière devenait illisible à cause de deux titres qui se ressemblent. Réglé par le
  numéro de position, unique par contrainte de base et utile à l'usage.
- [ ] **`HUB-RENDU`** — le hub ne REND pas encore `details` ni `primary` (son lot 2). Rien à
  faire dans ce dépôt : entrée gardée pour que « publié » ne se lise pas « affiché ».


### Chantier SEMAINE (demandé par Marc le 21/08, cadré et ouvert le 14/09)

Deux demandes : **classer les recettes**, et **s'en servir pour proposer une semaine**.

⚠️ Cette section a longtemps affirmé que « la seconde ne vaut rien sans la première ». C'était
FAUX, et Marc l'a tranché le 14/09 : la proposition se fonde d'abord sur ce qui est MESURÉ
(les temps, réels sur les 10 188 recettes ; la variété des ingrédients, calculée). `SEM-01`
l'a enrichie le même jour — la semaine propose désormais **3 plats + 1 dessert** — mais ne la
conditionnait pas.

- [x] ~~**`SEM-01` — le TYPE de plat.**~~ **Livré le 14/09.** Sept familles arbitrées par
  Marc — plat principal, entrée et apéro, accompagnement, soupe, salade, dessert, sauce et
  condiment — déduites du titre et des ingrédients, avec « non déterminé » comme réponse
  possible. Filtre dans le catalogue, étiquette sur les fiches, correction manuelle, et la
  semaine passe à **3 plats + 1 dessert**.

  | mesuré sur les 10 188 | |
  |---|---|
  | couverture | **91,4 %** (plat 44,6 · dessert 36,1 · soupe 2,9 · salade 2,8 · entrée 2,7 · sauce 1,2 · accompagnement 1,1) |
  | non déterminé | **8,6 %** |
  | exactitude | **54 sur 56**, échantillon stratifié de 8 par famille, jugé à la main |

  ⚠️ **Les deux erreurs sont nommées** : « Palmiers jambon-fromage » (apéro classé plat) et
  « Poêlée de pâtes aux légumes et émincés de poulet » (plat classé accompagnement). Deux
  confusions entre familles VOISINES, aucune absurde. ⚠️ 56 est un petit échantillon : la
  marge autour de 96 % est large, et ce chiffre ne se recopie pas sans sa taille.

  Trois règles sont nées de la mesure, chacune après une vraie erreur :
  - **un mot de famille doit OUVRIR le titre** (article toléré) pour les familles dont le mot
    peut qualifier un accompagnement — « Porc sauce aigre douce » est un plat, pas une sauce ;
  - **les mots qui servent des deux côtés sont AMBIGUS** et se tranchent aux ingrédients —
    « Flan de thon » contre « Flan pâtissier », « Verrines caramel » contre « Verrines de
    légumes » ;
  - **un camp sucré franc l'emporte** sur une famille salée du titre — « Frites de cookie ».

  ⚠️ **Les ligatures `œ`/`æ` sont remplacées AVANT la normalisation** : `NFD` ne les décompose
  pas, donc « bœuf » devenait « b uf » et perdait son marqueur salé, sur un corpus français
  où le boeuf est partout. Trouvé par un test, pas par une relecture.

  ⚠️ **La correction de Marc est indexée par `source_url`, jamais par l'id** :
  `npm run catalog:import` reconstruit le catalogue et change les ids. Et une correction à
  `null` (« aucune de ces familles ») est une DÉCISION, pas une absence — les deux se
  distinguent par la présence de la ligne, sinon elle serait écrasée au build suivant.

  Reste hors périmètre, non demandé cette fois : le RÉGIME (végétarien, gluten) et l'EFFORT.
  ⚠️ Si le gluten revient un jour, la règle reste ASYMÉTRIQUE — on peut affirmer « contient du
  gluten » quand on le détecte, jamais « sans gluten ». C'est une affirmation de santé, pas
  une catégorie.

- [x] ~~**`SEM-02` — quatre recettes proposées chaque semaine.**~~ **Livré le 14/09.** Carte
  « Ta semaine » sur l'accueil : quatre recettes du catalogue, remplaçables une à une, et un
  bouton qui monte le batch avec sa liste d'épicerie. ⚠️ La composition est passée à **3 plats
  + 1 dessert** avec `SEM-01`, le même jour : remplacer la carte du dessert rend un dessert,
  et une place que le catalogue ne peut pas pourvoir est DITE plutôt que comblée au hasard. Cadré par Marc le 14/09 — quatre
  recettes à CUISINER sans jour assigné, fabriquées à l'ouverture de l'app (pas de cron), sur
  des critères MESURÉS, une seule semaine vivante.

  | règle | ce qui la fonde |
  |---|---|
  | la semaine ne bascule pas le dimanche soir | `semaineISO` dans le fuseau de Marc — Vercel tourne en UTC, où il est déjà lundi à 20 h au Québec |
  | la proposition ne change pas quand on rafraîchit | tirage DÉTERMINISTE dont la graine est le numéro de semaine |
  | pas deux recettes qui se ressemblent | aucun ingrédient DISTINCTIF partagé ; « distinctif » = présent dans ≤ **2 %** du corpus (mesuré : 50 communs sur 15 389, 58 recettes sans distinctif) |
  | au moins une recette courte | total ≤ **30 min** (mesuré : p25 = 25, médiane = 40, p90 = 80) |
  | on ne repropose pas ce qui a été cuisiné | les recettes déjà passées dans un batch sont exclues |

  Vérifié par **18 tests**, dont un balayage des 52 semaines de 2026 sur le corpus réel, et
  **quatre mutations prouvées** (fuseau retiré, variété désactivée, échange supprimé, tirage
  rendu dépendant de l'ordre des lignes) — chacune fait rougir le test qui la vise.

  ⚠️ **Le test de corpus porte sur des présélections de 200**, pas sur les 10 188 : c'est ce
  que la production passe réellement à `choisirQuatre` (charger 87 444 lignes d'ingrédients
  par fabrication serait absurde). Une garantie prouvée sur un ensemble que le code n'utilise
  pas ne prouve rien.

  ⚠️ **Décision prise sans feu vert, et son alternative** : Marc a écarté l'historique des
  propositions, donc l'anti-répétition ne peut pas s'y appuyer. Elle se fonde sur les BATCHS,
  persistés de toute façon — plus juste (on évite ce qu'il a CUISINÉ, pas ce qu'on lui a
  MONTRÉ), mais **inerte tant qu'il n'a aucun batch**. L'alternative écartée était de garder
  l'historique, ce qu'il a refusé.

- [x] ~~**`SEM-05` — prix, temps et difficulté.**~~ **Livré le 14/09.** Demande de Marc :
  « estimé prix batch pour la semaine et temps et aussi un nombre d'étoiles pour toutes les
  recettes, estimé difficulté ». Trois chiffres sur la carte « Ta semaine », et des étoiles
  partout où une recette s'affiche.

  | mesuré sur les 10 188 | |
  |---|---|
  | notées | **10 185** (3 refusées : moins de deux signaux sur trois) |
  | distribution | 1★ 19,9 % · 2★ 19,8 % · 3★ 20,2 % · 4★ 20,0 % · 5★ 20,0 % |
  | signaux disponibles | trois sur **9 960** recettes · deux sur 225 · un ou zéro sur 3 |

  Arbitrages de Marc : **cinq niveaux** (il a écarté ma recommandation de trois), **un appel
  d'estimation par semaine** pour le prix, et **aucune étoile** quand les signaux manquent.

  ⚠️ L'échelle est **relative au catalogue** : les coupes sont les quintiles MESURÉS du score
  composite. Des seuils choisis au jugé auraient écrasé tout le monde sur 2-3-4 — trois
  signaux corrélés et moyennés font une cloche — et les étoiles 1 et 5 auraient été
  décoratives. C'est ce que teste le corpus, pas la moyenne.

  ⚠️ Ce qui est mesuré est l'**effort** (ingrédients, étapes, durée), jamais la **technique** :
  une omelette roulée sortira « très simple ». Aucun signal du corpus ne dit le contraire.

- [x] ~~**`SEM-03` — changer une recette de la semaine EN PARLANT à l'assistant.**~~ **Livré le 14/09.** La moitié
  restante de la demande du 21/08. Le bouton « Remplacer » couvre le besoin de façon
  déterministe ; ce qui manque est un outil d'ÉCRITURE côté assistant (`lib/assistant/`) pour
  que « mets-moi quelque chose avec du poulet à la place du troisième » fonctionne.
  ⚠️ `chercher_recettes` sait DÉJÀ répondre par ingrédients en disant ce qui est couvert et ce
  qui manque : la moitié « en fonction des ingrédients » est là, il manque l'écriture.

  ⚠️ **Prior art à REGARDER, pas à copier** : `WeekPlannerPage.tsx` (647 lignes) existe sur
  `archive/pre-web-2026-04-24` — un planificateur hebdomadaire à glisser-déposer de la V3.
  Autre pile (React Query, dnd-kit, API séparée) et bien plus lourd que ce que Marc demande.
  À ouvrir pour ce qu'il a appris du DOMAINE, pas pour son code.

  ⚠️ **Si l'idée d'un cron hebdomadaire revient un jour** : le plan Vercel Hobby n'accepte QUE
  des crons quotidiens — une expression hebdomadaire fait ÉCHOUER le déploiement (vécu par
  CarAI, « Hobby accounts are limited to daily cron jobs »). `SEM-02` s'en passe : la semaine
  se fabrique à l'ouverture de l'app.

  **Ce qui a été livré**, avec les arbitrages de Marc : l'assistant **propose**, Marc applique
  d'un bouton (il a écarté l'application directe) ; la composition « 3 plats + 1 dessert »
  **peut** être cassée s'il le demande, la carte l'avertissant avant le clic ; **le catalogue
  seulement** (la semaine y pointe en base). Plus, demandé en cours de lot : un bouton
  **« Propose-moi une autre semaine »** qui rejoue les quatre d'un coup, derrière une
  confirmation.


### Chantier CATALOGUE (plan arbitré par Marc le 19/08, un lot par PR)

Audit large des 10 188 recettes fait avant de proposer quoi que ce soit. Ce qui suit est
mesuré, pas supposé. ⚠️ `difficulté`, `type de repas`, `calories` et `tags` sont **vides dans
le seed** : il n'y a rien à en tirer, et on ne le promet pas.

- [x] ~~**`CAT-A` — le vrai nombre de portions.**~~ **Livré le 19/08.** Les 10 188 recettes
  annonçaient « pour 1 portion » et divisaient leurs quantités d'autant. Le rendement réel est
  retrouvé pour **10 049** d'entre elles (4 pers : 4 705 · 6 : 2 002 · 2 : 846 · 8 : 776…).
  `servings` et les quantités bougent ENSEMBLE, dans la même transaction : le facteur
  d'échelle d'un batch vaut `portions / servings`, donc **aucun batch existant ne bouge**.
- [x] ~~**`CAT-B` — la recherche insensible aux accents, à l'apostrophe et aux marques.**~~
  **Livré le 20/08.** Mesuré avant et après, sur le corpus entier :

  | on tape | titres avant → après | ingrédients avant → après |
  |---|---|---|
  | « creme » | 1 → **346** | 0 → **470** |
  | « pate » | 0 → **312** | 2 → **372** |
  | « legumes » | 1 → **332** | 0 → **83** |
  | « gateau » | 18 → **395** | 0 → 15 |
  | « crepe » | 0 → **114** | 0 → 24 |
  | « kub or maggi » | 0 → 0 | 0 → **3** |

  **6 057 titres et 8 964 noms** changent de forme cherchable. La comparaison se fait sur
  des colonnes **générées** (`GENERATED ALWAYS AS … STORED`) : un chemin d'insertion ne peut
  pas oublier de les remplir. Uniquement des fonctions immuables — pas d'extension
  `unaccent`, qui n'est pas immuable et demanderait un privilège sur Neon.
  ⚠️ La règle vit des deux côtés (Postgres et TypeScript). L'expression SQL est **fabriquée**
  depuis les constantes du module TS, et un tripwire vérifie que la migration porte
  exactement cette expression : changer la règle sans régénérer la migration fait échouer le
  test. Prouvé par mutation, comme le retour d'un chemin de recherche au texte brut.

- [x] ~~**`CAT-C` — temps de préparation et de cuisson.**~~ **Livré le 20/08.** La donnée
  était dans le seed depuis le début pour les **10 188 recettes** (médiane 15 min / 20 min)
  et n'avait jamais été importée : une fiche ne disait rien du temps qu'elle demande.
  Deux défauts mesurés AVANT de l'afficher, parce qu'une donnée fausse est pire que rien :
  - **71 durées étaient des minutes lues comme des heures** (« Funky Pop Corn », 1 800 min
    de préparation = 30 h). Preuve : 71 des 75 valeurs > 12 h sont des multiples EXACTS de
    60, contre **3,8 %** des valeurs plausibles — 25× d'enrichissement — et tous les
    quotients retombent sur des durées ordinaires. Les 4 restantes ne sont pas des
    multiples de 60 : intactes.
  - **224 recettes portent 0 en préparation ET 0 en cuisson** : donnée manquante, pas
    recette instantanée. Rien ne s'affiche. Un 0 en cuisson SEUL reste crédible et se dit.
  ⚠️ Garde né du lot : la copie catalogue → bibliothèque est vérifiée contre une liste
  **dérivée du schéma** (`getTableColumns`), pas réécrite à la main — c'est le défaut qui a
  fait entrer 40 offres sans ville en production chez JobAI.

- [x] ~~**`CAT-D` — ménage du texte affiché.**~~ **Livré le 20/08.**

  | | titres | instructions | noms d'ingrédient |
  |---|---|---|---|
  | espaces multiples | 23 | 1 662 | 1 |
  | accents décomposés (NFD → NFC) | 20 | 90 | 12 |
  | caractères invisibles | 19 | 30 | 130 |
  | entités HTML | 1 | 19 | 0 |
  | **total** | **63** | **1 802** | **143** |

  ⚠️ **L'inventaire initial a été démenti sur trois de ses cinq items**, et c'est la partie
  utile de ce lot :
  - « 6 instructions avec du mojibake » → **zéro**. Mon détecteur cherchait `Ã|Â|â€`, qui
    attrape les « À » et « Â » légitimes d'un corpus français. Le compte mesurait mon motif.
  - « 7 titres de plus de 120 caractères » → de vrais titres de plats gastronomiques.
  - « 71 instructions sans saut de ligne » → 37 font moins de 200 caractères et sont des
    recettes en UNE étape. Une seule dépasse 600. Re-segmenter aurait inventé une structure.

  ⚠️ **L'espace insécable est CONSERVÉ** (325 occurrences) : en français il est correct
  devant `; : ! ?`. Le « nettoyer » aurait abîmé un texte juste. Verrouillé par mutation.

- [x] ~~**`CAT-F` — le reliquat d'ingrédients (ex-`ING-09`).**~~ **Livré le 20/08 — il
  n'était pas irréductible.** 18 des 26 lignes se réparent par des règles EXACTES :
  - **12 noms tronqués sur 16** : le mot mangé vaut « unité du seed + fragment » ET figure
    LITTÉRALEMENT dans le texte source (« S (250Ml) De Farine T45 » ← « 2.5 **tasses**
    (250ml) de farine T45 »). Le budget de deux lettres reste en place partout ailleurs —
    c'est lui qui empêche « Ail » de devenir « Portail » ; la règle est un AJOUT.
  - **6 « grandes cuillères » comptées en grammes** : encore la frontière de mot, le `g` de
    « grandes ». 0,5 g d'arôme vanille devient 7,5 ml. L'unité était dans le TEXTE.

  Reste **8 lignes sur 87 444** : 4 noms non restaurables (« hachés », « fraise ») et 4
  écarts de rapport dont rien ne dit lequel des deux chiffres est faux.

- [x] ~~**`CAT-G` — les images.**~~ **Livré le 20/08, autrement que prévu.** Une sonde de
  vivacité aurait produit un chiffre périmé le lendemain, et je ne peux pas l'exécuter : le
  proxy de la session bloque le CDN et répond « 000 », pas « 404 » — un échec de MON réseau,
  qui ne dit rien de l'image. `components/ImageRecette.tsx` fait disparaître proprement une
  image qui ne charge pas, quel que soit leur nombre, et continue de marcher quand ce nombre
  change. Garde de surface : aucun `<img>` ne sert une adresse de recette sans repli.

- [x] ~~**`CAT-E` — les recettes retirées du catalogue.**~~ **Livré le 20/08**, après que
  Marc a tranché les trois piles (« supprime tout », 20/08). **18 recettes** sur 10 188 :
  1 vraiment vide (#1268, ni ingrédient ni instructions), 2 sans ingrédient mais avec un
  texte de préparation (#7596, #8038 — donnée perdue, invérifiable), et **15 doublons**,
  un exemplaire par groupe partageant titre ET liste d'ingrédients.

  ⚠️ **Mon cadrage initial annonçait 40 retraits et il était FAUX.** Les 22 recettes « à un
  seul ingrédient » sont des recettes normales — « Oeufs durs » (4 oeufs), « Purée d'amande »
  (250 g d'amandes), « Compote de nectarines » (8 nectarines), les cinq « Confiture de lait »
  déclinées par appareil. Elles ne sont PAS supprimées, et un test les protège nommément.
  Les avoir regardées une par une avant de coder est la seule raison pour laquelle elles
  existent encore.

  ⚠️ **Ne JAMAIS dédoublonner par titre** : sur les 87 titres partagés, 72 sont des variantes
  réelles (deux « sauce bolognaise » aux ingrédients différents). Le titre est un indice, la
  liste d'ingrédients est la preuve — verrouillé par mutation.

  Gardes de la seule suppression de l'app : liste calculée par un module PUR et testé, un
  **plafond** (25) qui fait échouer le build si le compte déborde, une résolution URL → ids
  **vérifiée avant d'écrire**, et le choix de l'exemplaire conservé fait sur l'URL (stable),
  jamais sur l'ordre d'arrivée. Réversible en pratique : `npm run catalog:import` reconstruit
  le catalogue entier depuis le seed committé.

- [x] ~~**`MCP-02` — poser `MCP_TOKEN` dans Vercel.**~~ **Fait le 19/08.** Marc a branché le
  connecteur claude.ai ; les outils rendent ses vraies données depuis la base de production.

- [x] ~~**`ING-03` — les noms d'ingrédients du catalogue portent des morceaux de quantité.**~~
  **Livré le 19/08.** Mesuré sur le corpus entier avant de coder : **2 371 entrées abîmées
  sur 15 389**, trois formes (« À Soupe De … », « Ousses … », « S De … »), toutes issues de
  la même faute de l'app V3 — une extraction d'unité sans frontière de mot (`g` reconnu DANS
  « gousses », `cuillères` retiré alors que l'unité est `cuillères à soupe`, `pincée` retiré
  au singulier). Réparation par retrait de préfixe, appliquée au catalogue, à la bibliothèque
  ET aux listes d'épicerie existantes, en automatique au déploiement. **965 réparations
  rejoignent un ingrédient déjà présent** : autant de lignes qui cessent de se dédoubler.

- [x] ~~**`CAT-H` — le catalogue annonçait 18 recettes de trop, à un MODÈLE.**~~ **Livré le
  15/09.** Deux chaînes disaient « catalogue de découverte de 10 188 recettes » alors que la
  production en sert **10 170** depuis que `CAT-E` en a retiré 18 : le prompt système de
  l'assistant et la description de l'outil MCP `batchchef_chercher_recettes`.

  ⚠️ **Ce n'est pas une coquille, c'est l'endroit le plus dangereux où laisser un chiffre
  rotter.** Ces deux chaînes ne sont lues par personne — elles partent à un modèle, qui peut
  les répéter à Marc avec l'assurance d'un fait, sans que rien ne les confronte jamais à la
  base. L'écran du catalogue, lui, affichait déjà un compte DÉRIVÉ (`count(*)`) : il n'a
  jamais menti.

  Correctif, deux réponses selon la nature du module :
  - **Le prompt se DÉRIVE** : `promptSysteme(nombre)` (dans `protocole.ts`, le module PUR)
    prend le compte en argument, et `repondre` le lit par `compterCatalogue()`. Un compte
    indisponible rend `null` → « plusieurs milliers de recettes », jamais un nombre inventé.
    Le `count` ne fait pas échouer la réponse : si la base est vraiment tombée, c'est le
    premier appel d'outil qui le dira, bruyamment.
  - **La déclaration MCP ne chiffre plus** : `lib/mcp/declarations.ts` est PUR par
    conception (testable sans next-auth), donc il ne peut pas lire le vrai compte — la seule
    réponse honnête y était de ne pas chiffrer.

  Gardes, prouvées par mutation : le nombre du prompt SUIT son argument (`promptSysteme(7)`
  doit dire 7 — un littéral ferait échouer le test), un compte `null` ne fabrique aucun
  nombre, et aucune description d'outil MCP ne porte de compte de recettes.
  ⚠️ `toLocaleString("fr-CA")` sépare les milliers par une **espace insécable** (U+00A0,
  mesuré) : la première version de l'assertion, écrite avec une espace ordinaire, échouait —
  la leçon des montants, repayée sur un compte.

## Livré (19/08)

- [x] **`MCP-01` — serveur MCP distant** (`POST /api/mcp`), lecture ET écriture (décisions de
  Marc du 19/08). Sept outils, JSON-RPC 2.0 écrit à la main, SDK officiel en devDependency
  comme tripwire de versions. Vérifié par onze sondes contre un serveur réellement démarré,
  pas seulement compilé.

- [x] ~~**`ING-04` — le bug de frontière a corrompu les UNITÉS.**~~ **Livré le 19/08.**
  325 ingrédients corrigés (`g`/`ml` → `unite`) d'après le texte source du seed, seule
  donnée qui porte encore la vérité. ⚠️ La passe **s'abstient** dès que les sources se
  contredisent (« 200 g de gingembre » contre « 1 gingembre ») : mesuré, 0 cas ambigu sur
  325, et le garde est prouvé par mutation.

- [x] ~~**`ING-05` — noms finissant par une préposition orpheline.**~~ **Traité autrement,
  et plus largement, le 19/08.** En mesurant ING-04, `ING-03` s'est révélée **incomplète** :
  ma détection ne cherchait que trois motifs, alors que le corpus en portait d'autres —
  `grosses`→« Rosses », `lamelles`→« Amelles », `clous`→« Ous », `demis`→« Mis ». La
  restauration se fait désormais depuis le texte source (`nomRestaure`), qui rend les lettres
  mangées sans avoir à énumérer les motifs : **677 noms** restaurés, contre 2 371 par
  préfixe. Elle refuse de restaurer au-delà de trois lettres perdues — au-delà, ce n'est plus
  une troncature, c'est un autre mot.

- [x] ~~**`ING-06` — audit exhaustif des 87 443 lignes d'ingrédients.**~~ **Fait le 19/08**,
  à la demande de Marc (« assure-toi qu'au moins 98 % est bon »). Méthode : rejeu complet de
  l'état de production depuis le seed, **calibré** contre la vraie base par le MCP (11
  ingrédients sur 11 identiques sur deux recettes), puis jugé contre le TEXTE SOURCE — jamais
  contre les règles de réparation, qui ne peuvent pas mesurer leur propre couverture.
  Résultat annoncé : **99,85 % correct** (134 lignes en défaut), après trois correctifs
  trouvés par l'audit lui-même. ⚠️ **Ce taux ne portait que sur deux colonnes sur trois** —
  le nom et l'unité. `ING-08` a mesuré la troisième et y a trouvé 2 671 lignes fausses. Un
  taux d'audit ne vaut que par l'axe qu'il nomme (cf. `docs/LESSONS.md`).

- [x] ~~**`ING-07` — le reliquat de quantités.**~~ **Traité par `ING-08`, et il était bien
  plus gros qu'annoncé** (voir ci-dessous : 134 lignes estimées, 13 448 corrigées).

- [x] ~~**`ING-08` — les QUANTITÉS reconstruites depuis le texte source.**~~ **Livré le
  19/08**, à la demande de Marc (« corrige pour avoir 100 % sur ce batch, puis teste avec
  beaucoup plus de données »).

  L'audit d'`ING-06` jugeait le nom et l'unité ; il ne voyait la quantité que par l'absurde.
  Un invariant plus fort existait : dans une recette, le rapport « nombre du texte source /
  quantité par portion » doit valoir le même rendement partout. **2 671 lignes s'en
  écartaient** — vingt fois le reliquat annoncé.

  | dégât | lignes corrigées | ce que Marc voyait |
  |---|---|---|
  | fraction en tête lue « 1 » | 2 403 | « 1/2 kg de viande hachée » facturé **1 kg** |
  | aucun nombre en source | 10 225 | « Huile — 1 », « Riz Pour L'Accompagnement — 1 » |
  | rendement irrécupérable (136 recettes) | 820 | « Thon — 0,02 g » pour « 200 g de thon » |

  Vérification : test de corpus sur les **87 444 lignes** (invariant indépendant des règles
  de correction), **3 000 batchs simulés** (48 931 lignes d'épicerie confrontées au texte
  source : 85 écarts d'arrondi à 0,018 % médian, 5 tracés aux lignes irréductibles nommées),
  et la preuve par l'usage sur le batch #13 — **20 articles sur 20** conformes à leur source.
  Huit mutations prouvées.

- [ ] **`ING-09` — les 26 lignes irréductibles (0,03 %).** Chacune mesurée et nommée ; aucune
  ne se corrige sans deviner. À rouvrir seulement si l'une gêne Marc en vrai.

  | classe | lignes | exemple | pourquoi c'est laissé |
  |---|---|---|---|
  | premier mot tronqué | 16 | « S (250Ml) De Farine T45 » ← « 2.5 tasses (250ml) de farine T45 » | restaurer 5 lettres n'est plus une troncature ; le budget est à 2 depuis qu'il a transformé « Ail » en « Portail ». La colonne `unit` du seed porte « tasse » (singulier) et le texte « tasses » : la piste existe, elle demande de rouvrir `nomRestaure`, qui a déjà cassé 595 restaurations aujourd'hui |
  | « grandes cuillères » en grammes | 6 | « 1 grandes cuillères d'arôme vanille » → 0,5 g | encore la frontière de mot (le `g` de « grandes ») ; la corriger demande de lire l'unité dans le TEXTE, pas dans la colonne |
  | écart de rapport inexpliqué | 4 | « 2.5 kg de moules », « 12 cl d'huile », « -134 oeufs », « -4600 g de pomme de terre » | l'un des deux chiffres est faux et rien ne dit lequel. Énumérées une par une dans `tests/quantitesSource.test.ts` |

- [x] ~~**`ING-10` — le double arrondi : « 1,98 gousses d'ail », « 499,98 g de haricots ».**~~ **Livré le 14/09.**
  Constaté le 14/09 en lisant quatre fiches du catalogue, trois portaient le défaut.

  **Cause exacte** : `normalizeQty` (`lib/units.ts`, son `round` interne) arrondit à deux
  décimales une quantité qui est encore **PAR PORTION** ; `import-catalog.ts` et
  `scripts/reparer-ingredients.ts` la multiplient ensuite par `servings`. L'erreur d'arrondi
  est donc multipliée par le nombre de portions. « 500 g » devient `83,33 × 6 = 499,98`.

  **Mesuré sur le seed** : **22 328 lignes sur 87 444 (25,5 %)** changent de chiffre pour au
  moins un nombre de portions entre 2 et 12 ; pire écart absolu **0,06**.

  ⚠️ **Ce n'est pas une régression de `CAT-A`, c'est sa mise en lumière.** Le double arrondi
  existait depuis l'import ; tant que `servings` valait 1 partout, la fiche affichait la
  quantité par portion déjà arrondie et personne ne voyait rien.

  ⚠️ **La valeur reste juste à 0,004 %** — ce qui se répare ici n'est pas un chiffre faux,
  c'est la CONFIANCE : « 4,02 carottes » se lit comme une erreur, et fait douter du reste de
  la fiche, y compris de ce qui est exact.

  Le correctif n'est **pas** d'une ligne : `normalizeQty` arrondit en interne et ne rend que
  deux décimales. Il faut lui faire porter la précision jusqu'au point d'écriture, et
  n'arrondir qu'une fois, après la multiplication. Les deux écrivains partagent la formule —
  les corriger séparément les ferait diverger au build suivant.

  **Livré** : `convertir` (privée, sans arrondi) devient le seul endroit qui lit la table des
  facteurs ; `normalizeQty` arrondit tout de suite, `normalizeQtyPourPortions` arrondit après
  avoir multiplié. Les deux écrivains passent par la seconde, et un tripwire exige qu'aucun ne
  remultiplie lui-même.

  ⚠️ **Le chiffre du ticket a été re-mesuré, et sa MÉTHODE corrigée.** Ma première mesure a
  rendu **zéro ligne changée** : j'utilisais `recipe.servings` du seed, qui vaut 1 presque
  partout — or l'app recalcule les portions (`portionsRecette`, `CAT-A`). À une portion, les
  deux formules donnent le même résultat par construction : la fixture rendait le défaut
  invisible. Re-mesuré avec les portions RÉELLES : **17 788 lignes sur 73 542 chiffrées
  (24,2 %)**, pire écart absolu **0,20** (amandes en poudre, 125,2 → 125 sur 40 portions).

- [x] ~~**Le doublon de la bibliothèque PERSO.**~~ **Réglé le 15/09 par Marc, en un clic.**
  Re-mesuré après coup : il ne reste **qu'un** « Fusilli à la crème champignons et poulet ».
  ⚠️ Le COMPTE de recettes n'est pas figé ici : écrit « treize » à 13 h, il valait **quatorze**
  au build de 13 h 36 — Marc venait d'ajouter `#16 Gratin végétarien`. Ce qui est stable, c'est
  l'absence de doublon ; le compte se lit dans le log de build. ⚠️ **L'exemplaire conservé est le #8, pas le
  #1** — c'est #1 qui est parti. Rien d'anormal : le bouton supprime la recette dont la fiche
  est AFFICHÉE (`recipeId={recipe.id}`), et la liste ne montre pas les ids, seulement les
  titres. Les deux étaient identiques au caractère près, donc le contenu conservé est le même
  dans les deux cas ; seul l'id de survie change, et c'est celui-là qu'il faut citer désormais.
  Aucun batch n'existait, donc aucune référence cassée.

  L'entrée d'origine, et ce que la mesure en avait démenti : « Fusilli à
  la crème champignons et poulet » figurait deux fois (`mes-recettes` #1 et #8, identiques au
  caractère près). `CAT-E` ne dédoublonne que le CATALOGUE : la bibliothèque perso n'a jamais
  été balayée. Re-mesuré le 14/09 avant d'écrire une ligne, et **deux affirmations de cette
  entrée étaient fausses** :

  - « deux recettes sur **quinze** » : la bibliothèque en compte **quatorze** (#10 n'existe
    plus), et #1/#8 sont la SEULE paire en double des quatorze. C'était une plage d'ids lue
    comme un compte.
  - « le mécanisme existe déjà et ne demanderait qu'une source d'entrée différente » :
    **non**. `retraitsCatalogue` groupe par titre + ingrédients puis désigne l'exemplaire
    gardé **par son URL** — or ces deux lignes-là partagent la leur. L'outil ne saurait pas
    les distinguer, et son verdict (« garde telle URL ») ne désignerait aucune des deux.

  Ce qui rend l'entrée caduque comme CHANTIER : le bouton « Supprimer » existe déjà sur la
  fiche (`components/DeleteRecipeButton.tsx` → `deleteRecipe`), et il refuse honnêtement si
  un batch utilise la recette (clé étrangère `restrict`, message dédié). Aucun batch n'existe
  aujourd'hui, donc rien ne bloque. **Arbitrage de Marc, 14/09** : il retire l'exemplaire en
  trop lui-même plutôt que de mettre une suppression de SES recettes dans le script de build,
  qui tourne à chaque déploiement, ou d'ouvrir la suppression au serveur MCP.

  ⚠️ **Ce qui reste vrai après coup** : lequel garder se lisait sur la FICHE, pas depuis une
  session — la provenance (`lib/origine.ts`) distingue « ajoutée par toi » d'une recette
  piochée au catalogue, et ni le serveur MCP ni le seed ne l'exposent. C'est pourquoi aucune
  recommandation du type « garde le plus petit id » n'a été donnée : elle aurait eu l'air
  informée sans l'être. Vaut pour tout futur doublon de la bibliothèque.

- [x] ~~**`SEC-01` — une RCE non authentifiée était ouverte en production.**~~ **Fermée le
  14/09**, trouvée en lançant le gate d'un lot sans rapport. `npm audit --omit=dev` rendait
  **2 avis (1 critique, 1 haut)** là où le `CLAUDE.md` exige zéro.

  | paquet | avis | ce que ça ouvrait |
  |---|---|---|
  | `next` 15.5.21 | GHSA-2xp9-vwfh-vxw4, **CRITICAL** | exécution de code à distance **sans authentification** dans l'API d'optimisation d'images, sur un fichier AVIF |
  | `sharp` 0.35.3 | GHSA-rgj7-g3m4-5g8c, HIGH | failles `libheif` héritées |

  ⚠️ **La surface était bel et bien ouverte** : `/_next/image` figure dans `isPublicPath`
  (`lib/authGuard.ts`), donc l'optimiseur répond sans session — vérifié avant de conclure, pas
  supposé. Le second avis Next du même lot (GHSA-p293-qw3h-jr36) ne vise que les serveurs
  Windows et ne s'appliquait pas à Vercel.

  Correctif : `next ^15.5.25`, `overrides.sharp ^0.35.4`. Les deux planchers sont inscrits
  dans `tests/dependances.test.ts` avec leur motif — un plancher MONTE, il ne redescend
  jamais —, et la discrimination est prouvée par mutation. `npm audit --omit=dev` : **0**.

  ⚠️ **Décision prise sans feu vert.** La convention dit qu'un défaut préexistant se signale
  et s'ajoute au backlog sans se corriger. L'alternative écartée était donc de laisser la
  faille ouverte en l'inscrivant ici : intenable pour une exécution de code à distance
  atteignable sans session sur un domaine public. Le correctif est une montée de version
  mineure, réversible, et le gate complet est resté vert.

## Écarté volontairement

- [x] ~~Recherche dans la bibliothèque perso~~ — **écarté par Marc le 17/08**. Le catalogue
  (10 188 recettes, ouvert rarement) a une recherche ; la bibliothèque perso, ouverte
  souvent, n'en a pas. Constat exact, mais Marc juge le volume actuel trop faible pour que
  ça vaille le travail. À rouvrir si la bibliothèque grossit.

## Idées non arbitrées

Rien n'est engagé ici — à proposer à Marc avant de coder.

- [ ] **Unité INCONNUE → compter des pièces plutôt que « au goût » ?** Envisagé pendant
  `ING-02` puis **écarté volontairement**. Ça sauverait le compte (« 3 verres » → 3 unités
  au lieu de rien), mais ça fabriquerait une nouvelle classe d'erreur : « 3 unités de lait »
  a l'air juste et ne l'est pas. Un aveu d'ignorance vaut mieux qu'un nombre plausible et
  faux — même arbitrage que « un 0 crédible est pire qu'un — honnête ». À rouvrir seulement
  si une mesure montre que les unités inconnues sont fréquentes ET majoritairement des pièces.

- [ ] Le stock ne sait pas ce qui a été mangé, seulement ce qu'il reste. Un historique
  permettrait « tu manges du chili trois fois par semaine », mais c'est de la mesure sans
  usage tant que personne ne l'a demandée.
- [ ] Le budget d'épicerie n'est jamais confronté au réel (pas de reçus — décision
  assumée dans `CLAUDE.md`). Aucun moyen de savoir si l'estimation est bonne à ±10 % ou à ×2.

## Retiré à la demande de Marc (17/08, soir)

- [x] ~~**Stock de portions** (frigo/congélo, onglet Portions, rangement en fin de batch)~~ —
  livré le matin, retiré le soir : Marc n'en veut pas. Tables `portions` et `pantry`
  supprimées (migration `0008`), ADR-0001 retiré.
- [x] ~~**`GM-01` — Garde-manger déclaratif**~~ — même décision. Le BESOIN reste (« je veux
  plus que ça me demande d'acheter du sel ou du poivre ») mais il doit être **automatique**,
  pas une liste à tenir : c'est `ING-01`.

## Fait

- [x] **`BOT-02` — Cartes de recettes cliquables dans le chat.** Une recette citée par
  l'assistant devient une pastille ; elle ouvre la fiche (ingrédients + préparation)
  PAR-DESSUS la conversation, qui n'est jamais détruite. Demande de Marc, 19/08/2026.
- [x] **`BOT-01` — Assistant Claude sur la base.** Onglet `/assistant`. Claude fouille via
  trois outils (recherche par ingrédients avec couverts/manquants calculés en SQL, lecture
  d'une recette, fréquence des ingrédients). Bornes : 8 allers-retours max — la borne
  atteinte est DITE —, historique tronqué sur frontière paire, coût compté par tour.
  19/08/2026.
- [x] **`ING-01` — Sel, poivre et eau hors de la liste d'épicerie.** Automatique, liste
  fermée dans le code, appariement mot à mot (« poivron » survit), écart DIT à l'écran.
  19/08/2026.
- [x] **`ING-02` — Quantités : 58 % → 28 % de perte.** Mesuré avant/après sur 50 unités
  réelles. La cause était l'asymétrie FR/EN de la table d'unités, pas la couche que je
  soupçonnais. Les 28 % restants sont des contenants sans taille fixe — pertes légitimes.
  19/08/2026.
- [x] ~~**`GM-01` — Garde-manger.**~~ Bouton « Placard » sur chaque article restant d'une liste,
  section « à vérifier au placard » (repliée, cochable, JAMAIS supprimée), écran
  `/garde-manger` pour défaire. Table vide au départ, comme décidé. 17/08/2026.
- [x] **`ACC-01` — Compteur d'accueil.** Jointure sur `batches` + exclusion des batchs
  terminés : le chiffre ne se dégrade plus avec le temps. 17/08/2026.
- [x] **Stock de portions** — le cycle se referme après « terminé ». 17/08/2026,
  `docs/adr/0001-portions-en-stock.md`.
- [x] **Documents vivants** (`HANDOVER.md`, ce fichier, `docs/LESSONS.md`, `docs/adr/`) —
  le dépôt n'en avait aucun. 17/08/2026.
- [x] **Verrou du socle visuel** (`web/tests/theme.test.ts`) après la régression texte blanc
  sur blanc. 14/08/2026, PR #55.
- [x] **Web Analytics** — PR #44, conflit résolu et mergée. 17/08/2026.
