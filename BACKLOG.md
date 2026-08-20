# BACKLOG — BatchChef

> Convention de l'écosystème (FinanceAI, DriveAI, JobAI) : **chaque tâche porte une case**
> `- [ ]`. Une note sans travail à faire n'est pas une tâche — elle va dans un ADR ou dans
> `docs/LESSONS.md`. Un item fini se coche **au merge**, dans la même PR que le code.
>
> ⚠️ Un item peut être **périmé** : vérifier l'état réel avant de coder.

## En cours / décidé, pas encore livré

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

- [ ] **`CAT-D` — ménage du texte.** 1 entité HTML (`&quot;`), 23 titres à espaces douteux,
  7 titres > 120 caractères, 6 instructions avec du mojibake, 5 vides, et **71 instructions
  sans le moindre saut de ligne** (un bloc illisible). S'y ajoutent, trouvés en préparant
  `CAT-B` : les 32 titres/noms en accents décomposés (à recomposer en NFC), les 149
  `U+FE0F` invisibles et les 325 espaces insécables.
  ⚠️ Distinguer `CAT-B` de `CAT-D` : `CAT-B` normalise ce qu'on CHERCHE (colonne dérivée,
  le texte affiché reste tel quel), `CAT-D` corrige ce qu'on AFFICHE. Les deux touchent les
  mêmes caractères mais pas la même colonne — les confondre réécrirait des titres pour une
  raison de recherche.
- [ ] **`CAT-E` — recettes creuses et vrais doublons, SUPPRIMÉES** (décision de Marc,
  19/08 : « supprimer pour de bon »). 3 recettes sans aucun ingrédient, 22 avec un seul,
  15 vrais doublons. ⚠️ **Ne PAS dédoublonner par titre** : sur les 87 titres partagés, 72
  sont des variantes réelles (deux « sauce bolognaise » différentes). Mesuré. Réversible en
  pratique : le catalogue est une dérivation pure du seed committé.
- [ ] **`CAT-G` — sonder les images.** Toutes sur le CDN Marmiton, 0 non-https. ⚠️ Leur
  vivacité n'est **pas** vérifiable depuis une session Claude (le proxy bloque `afcdn.com`,
  code 000 ≠ 404) : ça se sonde depuis l'app, une passe bornée.

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
