# Principes non négociables (ancien §1)

> Repris mot pour mot de l'ancien `CLAUDE.md` (lignes 23 à 317). Index : [`docs/INDEX.md`](../INDEX.md).

## Stack et accès (en-tête de l'ancien CLAUDE.md, lignes 3 à 21)

Planificateur de batch cooking québécois, **100 % en ligne**. Toute l'app vit dans `web/`.

- **Next.js 16** (App Router, Server Components + Server Actions), **Vercel**, **Node 24**
  (`.nvmrc` ; monté de 15 et 22 le 23/09, #109 et #110).
- **Drizzle ORM** + **Neon** (Postgres serverless).
- **Auth.js v5** (Google — BatchChef GARDE son fournisseur, contrairement à JobAI/CarAI),
  middleware fail-closed. **Qui entre : deux étages**, pas une mono-adresse.
  `AUTHORIZED_EMAIL` est le **propriétaire** (vérifié d'abord et **sans réseau**, pour
  qu'une panne du hub n'enferme pas Marc dehors) ; toute autre adresse passe par
  `aAccesHub` (`web/lib/accesHub.ts` → `POST /api/acces` du hub). La liste vit dans la
  table `acces` du hub et se gère depuis `hubperso.com/administration` — **inviter
  quelqu'un ne demande PAS de toucher à `AUTHORIZED_EMAIL` ni de redéployer**.
  Le contrôle est **rejoué à chaque lecture** (`jwt`), pas seulement à la connexion : le
  cookie étant partagé entre les apps du hub, il pourrait venir d'ailleurs.
- **LLM** (`@anthropic-ai/sdk`) pour le parse de recettes et l'estimation des prix.
- **Tailwind v4**, **Zod 4** (monté de 3 le 23/09, #115), **vitest ~4.1** — PAS 5 : l'outil de
  mutation ne sait pas encore le piloter et rend un score faux (#119).

> 📐 Structure de ce fichier et de `docs/` : [convention commune aux huit dépôts](https://github.com/MoKarade/claude-config/blob/main/conventions/STRUCTURE-DEPOT.md).

## 1. Principes non négociables

- **No fake data.** Un parse douteux est rejeté (Zod), jamais inséré sale. Les prix sont
  des **estimations** (LLM + filet déterministe, couverture 100 %) — jamais présentés comme
  des prix relevés. Pas de scraping, pas de reçus.
- **Pas de scraping, y compris pour les vidéos.** L'import vidéo ne va RIEN chercher chez
  Instagram/TikTok : c'est Marc qui dépose le fichier, la capture d'écran ou la description
  (contenu auquel il a accès), le lien ne sert que de `sourceUrl`. Un jour où l'on voudra
  « juste récupérer la légende depuis l'URL », c'est ce garde-fou qu'on serait en train de
  lever. Trois murs, pas un : ce garde-fou, les conditions d'Instagram (et le risque de faire
  bloquer le compte de Marc en utilisant ses cookies depuis un serveur), et le fait qu'aucune
  API Meta ne rend le média d'un créateur tiers — l'oEmbed officiel rend un code
  d'intégration, jamais un fichier. Corollaire assumé : Instagram ne partageant qu'une URL,
  la voie normale est l'**enregistrement d'écran** que Marc produit lui-même (un seul fichier
  porte les gestes, les quantités affichées ET la légende dépliée), avec en repli les
  captures d'écran et le texte collé.
- **Le schéma tolère la FORME, jamais le FOND — et un refus NOMME le champ.** Un modèle
  varie dans la façon de rendre (instructions en tableau plutôt qu'en texte, nombre en
  chaîne) : ces variations sont normalisées (`aplatirTexte`, `aplatirNombre`), sinon une
  recette juste est jetée après un appel vision déjà payé. Mais on ne devine JAMAIS le fond :
  « environ 4 » ne devient pas `4` (toutes les quantités de l'épicerie s'échelonnent sur
  `servings`), et une étape non réductible en texte fait échouer plutôt que de produire un
  « [object Object] » présenté comme une consigne. Tout refus passe par
  `analyserSortieRecette`, qui dit QUEL champ cloche — le message brut de Zod (« Expected
  string, received array ») ne le dit pas, et coûte un aller-retour entier à deviner.
- **Un service worker n'intercepte QUE des navigations.** Une Server Action de Next POSTe
  vers l'URL de la page COURANTE : depuis `/partage`, l'analyse poste donc elle aussi vers
  `/partage`. Un worker qui teste « POST + bon chemin » l'avale et répond une redirection
  303 au lieu du résultat — le navigateur affiche « An unexpected response was received from
  the server » et **les journaux serveur sont vides**, puisque la réponse a été fabriquée
  dans le téléphone. Diagnostic : « erreur opaque + aucune trace côté serveur » ⇒ regarder le
  worker AVANT l'authentification. Le discriminant est `request.mode === "navigate"`
  (standard Web Share Target), jamais un en-tête interne de Next. Verrouillé des deux côtés
  par `tests/partage.test.ts` (`doitIntercepterPartage` + tripwire sur `sw.js`),
  discrimination prouvée par mutation.
- **Une vidéo se sonde DENSÉMENT et se trie par ÉCRAN, jamais à intervalle fixe.** Mesuré :
  ~12 images réparties sur 30-45 s laissaient une carte de quantité affichée 2 s passer une
  fois sur deux. `lib/video/frames.ts` sonde à la seconde, ne garde qu'une empreinte 8×8 par
  sonde, puis n'extrait en pleine résolution que les écrans distincts. La comparaison se fait
  avec la dernière image GARDÉE, pas la précédente — sinon un défilement lent (la légende) ne
  laisse qu'une seule image. Verrouillé par `tests/video.test.ts`, discrimination prouvée par
  mutation.
- **Une capture d'écran prime sur une image de vidéo.** Le budget d'images
  (`repartirBudget`) sert les captures en premier : elles portent les quantités écrites,
  une image de vidéo ne montre souvent qu'un geste.
- **Un chiffre par défaut se DIT.** Une vidéo n'annonce presque jamais ses portions ; le
  défaut 4 est affiché comme un défaut à corriger (`servingsGuessed`), parce que toutes les
  quantités de la liste d'épicerie sont mises à l'échelle à partir de lui. Même règle pour
  tout futur champ qu'on remplirait faute de source. Idem pour la **provenance**
  (`lib/origine.ts`) : la bibliothèque mélange ce que Marc a apporté et ce qu'il a pioché
  dans le catalogue, et une origine absente rend « Origine non
  enregistrée » — jamais « ajoutée par toi », qui lui attribuerait des recettes qu'il n'a
  jamais choisies.
- **La transcription audio est une source d'APPOINT, jamais un arbitre.** La reconnaissance
  vocale se trompe surtout sur les nombres et les unités — ce qui compte le plus ici. Le
  prompt lui interdit de contredire un écrit (texte à l'écran, description) ; elle ne sert
  qu'à compléter, et une quantité entendue mais incertaine devient `qty: null`. L'audio
  seul ne suffit d'ailleurs pas à lancer une extraction. `GROQ_API_KEY` absente ⇒
  « transcription non configurée » (intégration éteinte), à distinguer d'un échec, qui
  affiche le motif du fournisseur : les confondre les rendrait tous deux invisibles.
- **Le coût publié au hub suit le modèle RÉELLEMENT appelé.** Deux modèles cohabitent
  (texte Haiku, vision Sonnet) : `lib/llmUsage.ts` tarife par modèle. Ajouter une ligne à sa
  table dès qu'un nouveau modèle est utilisé, sinon son coût est compté au tarif d'Haiku.
- **Server-side only.** Fetch, jetons et écritures restent côté serveur ; chaque Server
  Action revérifie la session (`requireSession`).
- **Unités normalisées** au parse (`lib/units.ts` → g/ml/unite ou null « au goût »).
- **La source peut être dans une autre langue ; la sortie est toujours française.** Une
  partie des reels sont en anglais. Deux conséquences non négociables : `lib/units.ts`
  connaît les unités impériales (cup, oz, lb, tbsp…) — sans elles, TOUTES les quantités
  d'un reel anglais tombaient en `null` et la liste d'épicerie sortait sans un chiffre,
  sans une seule erreur affichée ; et le `canonical` est TOUJOURS en français parce que
  c'est la **clé de regroupement** de la liste (« chicken breast » et « poitrine de
  poulet » feraient deux lignes qui ne fusionnent jamais). Un contenant sans taille fixe
  (`can`, `package`, `bunch`) reste `null` : on n'invente pas un poids.
- **Toute unité ajoutée dans une langue se pose DANS LES DEUX.** Mesuré le 19/08/2026 sur
  50 unités réelles : **58 % des quantités tombaient en « au goût »**, et la cause n'était pas
  l'anglais mais le FRANÇAIS — les entrées anglaises avaient été ajoutées en bloc sans revoir
  leurs équivalents (`cloves` → 2 unités mais `gousses` PERDU, `lb` → 907 g mais `livre`
  PERDU). Une asymétrie ne lève rien : la quantité disparaît, la recette a l'air extraite, et
  la liste sort sans chiffre. Verrou : `tests/units.test.ts`, section « symétrie FR/EN ».
  Corollaire : **un DÉNOMBRABLE n'est pas « au goût »** (« 4 œufs », « 2 branches ») et un
  CALIBRE (`large`, `gros`) est un adjectif de taille, pas une unité — la quantité reste le
  compte. Ce qui n'a vraiment pas de taille fixe (`pincée`, `botte`, `can`) reste `null` :
  la frontière ne bouge pas, on n'invente toujours aucun poids.
- **Le `canonical` hérité du catalogue V3 est réparé au déploiement** (`ING-03`,
  `lib/ingredientsNoms.ts`, PUR et testé). L'app V3 retirait l'unité du texte source **sans
  frontière de mot** : `g` reconnu DANS « gousses », `cuillères` retiré alors que l'unité est
  `cuillères à soupe`, `pincée` retiré au singulier. D'où « Ousses D'Ail », « À Soupe De
  Persil », « S De Sel » — 2 371 entrées sur 15 389, mesurées. ⚠️ Le défaut n'était PAS
  cosmétique : `canonical` est la clé de regroupement, donc deux clés = deux lignes sur la
  liste. La passe (`npm run db:reparer-ingredients`, dans `vercel-build`) couvre les **trois** tables
  où le nom atterrit — catalogue, bibliothèque, listes existantes — et l'import du catalogue
  répare aussi, sinon une ré-importation ré-introduirait le défaut. Verrouillé par
  `tests/deploiement.test.ts`.
  ⚠️ **Le même bug a aussi faussé les UNITÉS** (`ING-04`) : `1 gousses d'ail` a été
  enregistré en `g`, donc « 3 g d'ail » là où il en faut trois gousses. Là, c'est ce qu'on
  ACHÈTE qui est faux. Non réparable depuis la production (`unit='g'` ne porte aucune trace
  de « gousse ») : la vérité n'est plus que dans `raw_text` du seed, que `lib/ingredientsSource.ts`
  relit. ⚠️ La passe **s'abstient** dès que les sources d'un ingrédient se contredisent —
  « 200 g de gingembre » ne doit JAMAIS devenir 200 unités. Le garde est prouvé par mutation.
  ⚠️ Leçon de méthode : `ING-03` s'était crue complète (« 2 371 détectées, 2 371 réparées »)
  parce qu'elle **comptait avec son propre détecteur**. Le corpus en portait 677 de plus,
  sous des formes que mes trois motifs ne connaissaient pas. Mesurer la complétude avec
  l'instrument qui définit le périmètre ne mesure rien.
- **Les QUANTITÉS se reconstruisent depuis le texte source** (`ING-08`,
  `lib/quantitesSource.ts`, PUR et testé). L'invariant : dans une recette, le rapport
  « nombre du texte / quantité par portion » vaut le même **rendement** partout — c'est le
  diviseur que la V3 a appliqué, et il se retrouve par vote majoritaire. Trois dégâts
  corrigés, 13 448 lignes : une **fraction en tête lue « 1 »** (« 1/2 kg de viande hachée »
  facturé 1 kg — Marc achetait le double), **aucun nombre dans la source** mais une quantité
  quand même (« huile » → « 1 »), et un **rendement irrécupérable** (136 recettes divisées
  par 500, 1 250, 10 000 — « 200 g de thon » affiché « 0,02 g »).
  ⚠️ **On ne corrige QUE ce qu'on sait expliquer** : quatre lignes restent en écart sans
  explication et ne sont pas touchées. Une correction au jugé sur ce qui décide de ce que
  Marc achète serait pire que le défaut.
  ⚠️ **Deviner une PIÈCE n'est pas deviner une MESURE.** « branche de persil » se lit « une
  branche » ; mais la liste de mots ne suffit pas — « clou de girofle » porte `unit='cl'`
  (le « cl » de « clou ») et aurait donné 10 ml, « lamelle de truffe » un litre. Le garde
  regarde l'unité d'ARRIVÉE, pas le mot.
  ⚠️ Le taux d'un audit ne vaut que par l'AXE qu'il nomme : `ING-06` annonçait 99,85 % en
  ne jugeant que le nom et l'unité. La troisième colonne portait 2 671 lignes fausses.
- **Un ARRONDI, et il vient APRÈS la multiplication** (`ING-10`, `normalizeQtyPourPortions`).
  Le catalogue stocke une quantité PAR PORTION que les deux écrivains multiplient ensuite par
  `servings` : arrondir avant de multiplier multiplie aussi l'erreur. « 50 g » sur 6 portions
  donnait `8,33 × 6 = 49,98`, « 2 pièces » donnait `1,98`, « 4 tranches » `4,02`. Mesuré le
  14/09 : **17 788 lignes sur 73 542 chiffrées (24,2 %)** changent, pire écart absolu **0,20**.
  ⚠️ **Ce qui se répare n'est pas un chiffre faux, c'est la CONFIANCE.** La valeur était juste
  à une fraction de pour cent ; mais « 4,02 tranches de jambon » se lit comme une erreur et
  fait douter du reste de la fiche, y compris de ce qui est exact.
  ⚠️ **Une seule conversion, deux entrées.** `convertir` (privée, sans arrondi) est le seul
  endroit qui lit la table des facteurs ; `normalizeQty` arrondit tout de suite (affichage,
  import LLM où la quantité vaut déjà pour la recette entière), `normalizeQtyPourPortions`
  arrondit après avoir multiplié. Une seconde copie de la conversion divergerait au premier
  facteur ajouté d'un seul côté — et la moitié des recettes serait convertie autrement que
  l'autre, sans qu'aucune erreur n'apparaisse. Verrou : `tests/deploiement.test.ts` exige que
  **les deux** écrivains passent par la formule partagée et qu'aucun ne remultiplie lui-même.
- **Sel, poivre et eau ne vont jamais sur une liste d'épicerie** (`lib/ingredientsDeFond.ts`).
  AUTOMATIQUE et sans rien à tenir à jour — c'est l'inverse du garde-manger déclaratif, livré
  puis retiré le 17/08 : Marc a refusé de tenir une liste, pas de ne plus acheter de sel.
  ⚠️ La liste est FERMÉE et l'appariement se fait MOT À MOT, jamais par sous-chaîne :
  « poivron » contient « poivr », et une correspondance floue le sortirait de la liste — une
  erreur qui ne se voit pas à l'écran mais se découvre en cuisinant. « eau » n'est reconnu
  que sur la forme EXACTE (« eau de fleur d'oranger » s'achète). Et l'écart est **DIT** sous
  la liste, en nommant les ingrédients : ce qui sort de la liste sort aussi du budget, et un
  chiffre qui baisse sans explication fait douter du reste.
- **L'assistant FOUILLE la base, il ne l'imagine pas.** Décision de Marc (19/08/2026) :
  Claude reçoit des OUTILS (`lib/assistant/outils.ts`) et interroge la base en plusieurs
  allers-retours plutôt qu'un pré-filtre SQL suivi d'un seul appel — il peut donc creuser.
  Trois conséquences non négociables :
  ⚠️ **Une recette citée doit avoir été LUE** : le prompt exige le numéro (`[catalogue #482]`)
  pour ce qui vient de la base, et un « je te la compose » explicite pour ce qui est inventé.
  Confondre les deux ferait chercher à Marc une recette qui n'existe pas. Ce marqueur devient
  une **carte cliquable** (`decouperReponse`) qui ouvre la fiche **PAR-DESSUS** le chat —
  jamais une navigation : la conversation vit dans l'état d'un composant client et une
  navigation la détruirait, donc Marc perdrait l'échange qui vient de produire la suggestion.
  Le parseur est tolérant sur la FORME (`#` optionnel, casse, espaces) et strict sur le FOND :
  une source inconnue ou un id non entier ne produit AUCUNE carte — une carte est une
  promesse, et une carte vers du vide est un faux.
  ⚠️ **Le contenu de la base est de la DONNÉE, jamais des instructions** : le catalogue vient
  de 10 188 pages web que personne n'a relues. Tout passe par `baliserDonnee`, qui neutralise
  aussi une fermeture de balise glissée dans le texte.
  ⚠️ **Bornes** : `MAX_TOURS_OUTILS` (la borne atteinte est DITE, pas déguisée en réponse
  complète) et `tronquerHistorique`, qui TRONQUE au lieu de rejeter — et coupe sur une
  frontière préservant l'alternance `user`/`assistant`, sinon l'API refuse tout. Chaque tour
  est compté dans `llm_usage` (action `assistant`) : une question en produit PLUSIEURS.
- **Le serveur MCP écrit par les FONCTIONS DE TRAVAIL de l'app, jamais en SQL réécrit.**
  `POST /api/mcp` (ADR-0001) ouvre la base à un Claude extérieur, en lecture **et** en
  écriture (décision de Marc, 19/08). Les trois outils qui écrivent appellent
  `creerBatchInterne` / `ajouterDuCatalogueInterne` / `cocherArticleInterne` — les Server
  Actions moins le `requireSession`. Deux implémentations d'une même règle, c'est une règle
  et demie : un batch créé par Claude doit écarter le sel et estimer ses prix comme un batch
  créé au doigt.
  ⚠️ **`/api/mcp` est hors du middleware de session, par ÉGALITÉ STRICTE** (`isPublicPath`),
  jamais un préfixe : sous la garde, un appelant machine reçoit une redirection HTML vers
  `/login` au lieu du JSON-RPC — serveur muet, zéro erreur. Verrouillé par
  `tests/auth.test.ts`, discrimination prouvée par mutation.
  ⚠️ **Trois réponses distinctes** : `MCP_TOKEN` absent → **503** (intégration éteinte),
  jeton faux/absent → **401**, méthode ≠ POST → **405**. Les confondre rendrait
  indiscernables « pas configuré » et « quelqu'un frappe à la porte ».
  ⚠️ **L'interface de connecteurs de claude.ai ne prend QU'UNE URL — pas d'en-tête.** Un
  serveur gardé par un `Authorization` statique y répond 401 sans rien à découvrir, et le
  connecteur échoue sans dire pourquoi (l'app, elle, marche parfaitement par ailleurs).
  D'où l'**OAuth 2.1 mono-utilisateur** (ADR-0002, calqué sur FinanceAI qui a buté sur le
  même mur le 13/07) : `lib/mcp/oauth.ts` est PUR et testé, le jeton direct reste accepté
  pour Claude Code. Ce qui livre l'accès si on le bâcle, tout verrouillé par mutation :
  allowlist de redirection par **origine exacte** (`https://claude.ai@evil.com` a pour host
  `evil.com`), **PKCE S256** obligatoire, **type dans la charge signée** (sans lui un code
  d'autorisation — qui transite en clair dans une URL — ouvrirait `/api/mcp`), usage unique
  et rotation. ⚠️ L'usage unique et le plafond de tentatives vivent en **BASE**, jamais en
  mémoire : en serverless un compteur de process est remis à zéro par l'instance suivante,
  ce qui en fait un garde décoratif.
  ⚠️ **Le client MCP vise `batchchef.hubperso.com`, JAMAIS une URL `*.vercel.app`.** La
  protection Vercel du projet est en `all_except_custom_domains` (vérifié le 19/08) : toute
  URL `*.vercel.app` — préversions ET alias de production — répond **302 vers
  `vercel.com/sso-api`** AVANT que l'app ne tourne. Le client ne voit jamais le JSON-RPC et
  rien ne lui dit pourquoi. Vaut pour toute future surface appelée par une machine.
  ⚠️ **Le SDK officiel reste en devDependency** (8,7 Mo, 17 deps runtime dont express/hono,
  pour un transport à SESSIONS dont une fonction serverless n'a que faire). Il sert de
  TRIPWIRE de versions dans `tests/mcp.test.ts` : nos constantes recopiées dériveraient
  sinon en silence, et une dérive de protocole se manifeste par un client muet, pas par une
  erreur. Ce qui N'EST PAS exposé : l'import par URL — il court-circuiterait l'écran de
  validation (« le LLM propose, le code valide, Marc confirme »).
- **Le TYPE d'une recette est une ESTIMATION, et l'app le DIT** (`SEM-01`, `lib/typePlat.ts`,
  PUR et testé). Sept familles fermées — plat, entrée et apéro, accompagnement, soupe, salade,
  dessert, sauce et condiment — déduites du titre et des ingrédients, parce que `meal_type`,
  `difficulty` et `tags_json` sont NULL sur les 10 188 recettes du seed. Mesuré le 14/09 :
  **91,4 % classées**, exactitude **54/56** sur un échantillon stratifié jugé à la main.
  ⚠️ `null` (« non déterminé ») est une réponse LÉGITIME : tomber dans la famille la plus
  probable ferait passer une ignorance pour une donnée, ce que le reste de l'app s'interdit.
  ⚠️ **Trois règles, chacune née d'une erreur mesurée** : un mot de famille doit OUVRIR le
  titre quand il peut qualifier un accompagnement (« Porc sauce aigre douce » est un plat) ;
  un mot qui sert des deux côtés est AMBIGU et se tranche aux ingrédients (« Flan de thon »
  contre « Flan pâtissier ») ; un camp sucré franc l'emporte sur une famille salée du titre
  (« Frites de cookie »), mais **jamais l'inverse** — beurre et oeufs sont des faux amis en
  pâtisserie.
  ⚠️ **`œ` et `æ` se remplacent AVANT `normalize("NFD")`**, qui ne décompose pas les
  ligatures : « bœuf » devenait « b uf » et perdait son marqueur salé, sur un corpus français
  où le boeuf est partout.
  ⚠️ **La correction de Marc vit dans `type_corrections`, indexée par `source_url`** — jamais
  par l'id du catalogue, que `npm run catalog:import` renumérote. Et une correction à `null`
  est une DÉCISION (« aucune de ces familles »), distinguée de l'absence de correction par la
  PRÉSENCE de la ligne : sinon elle serait écrasée par l'estimation au build suivant.
  ⚠️ Si le RÉGIME revient un jour au programme, la règle du gluten reste **asymétrique** — on
  peut affirmer « contient du gluten » quand on le détecte, jamais « sans gluten ». C'est une
  affirmation de santé, pas une catégorie.
- **La DIFFICULTÉ est une estimation d'EFFORT, relative au catalogue** (`SEM-05`,
  `lib/difficulte.ts`, PUR et testé). Cinq étoiles (arbitrage de Marc, 14/09), déduites de
  trois signaux et de rien d'autre : nombre d'ingrédients, nombre d'étapes, durée totale.
  `difficulty` est NULL sur les 10 188 recettes du seed, comme `meal_type` et
  `estimated_cost_per_portion` — il n'y a rien à lire, tout est à déduire.
  ⚠️ **Les coupes sont les QUINTILES MESURÉS du score composite**, pas des seuils choisis.
  Trois signaux corrélés et moyennés font une cloche : des seuils « ronds » écrasent tout le
  monde sur 2-3-4 et rendent les étoiles 1 et 5 décoratives (mesuré, et c'est la mutation qui
  garde le test du corpus). Conséquence à DIRE : « 1 étoile » signifie « parmi les plus
  simples du catalogue », jamais « facile dans l'absolu ».
  ⚠️ **Ce qui est mesuré est l'EFFORT, pas la TECHNIQUE.** Une omelette roulée sort « très
  simple » — aucun signal du corpus ne dit le contraire, et l'inventer serait précisément le
  défaut que le reste de l'app s'interdit. Les libellés parlent d'exigence, jamais de
  savoir-faire.
  ⚠️ **Un signal ABSENT est retiré de la moyenne, jamais compté comme zéro** : une durée
  inconnue ferait passer une recette pour la plus simple du catalogue. En dessous de deux
  signaux sur trois, la réponse est « non estimée » (3 recettes sur 10 188).
- **Le prix de la SEMAINE passe par les mêmes fonctions que celui du BATCH** (`SEM-05`,
  `prixSemaine` dans `lib/semaineDb.ts`) : `aggregateShoppingList` →
  `ecarterIngredientsDeFond` → `estimateShoppingCosts` → `fillMissingCosts`, sur les MÊMES
  portions. Deux implémentations d'une même règle, c'est une règle et demie — Marc verrait un
  prix avant de monter le batch, un autre après, pour exactement les mêmes courses.
  ⚠️ Il est calculé **une fois par composition** et mémorisé (`week_estimations`), et la
  `signature` des recettes déclenche le recalcul : sans elle, remplacer une recette laisserait
  à l'écran le prix d'une semaine qui n'existe plus. ⚠️ Un échec d'appel ne fait pas
  disparaître le prix (le filet déterministe chiffre tout) mais change `methode`, **que
  l'écran dit** — un tarif forfaitaire présenté comme une estimation par ingrédient serait le
  même défaut, déplacé.
  ⚠️ **Une recette sans durée ne vaut pas 0 minute** dans le temps de la semaine : elle sort
  du total et son titre est nommé (`tempsSemaine`, pur). 224 recettes sur 10 188 n'ont aucune
  durée dans la source.
- **L'assistant PROPOSE un changement de semaine, Marc l'applique** (`SEM-03`, arbitrage de
  Marc du 14/09 — il a écarté l'application directe). Le marqueur `[semaine 3 ← catalogue
  #482]` devient un BOUTON, comme `[catalogue #482]` devient une carte : même mécanisme, même
  sévérité. ⚠️ **Tolérant sur la FORME** (flèche `←`, `<-`, `->` ou absente, `#` optionnel,
  casse ignorée — un modèle varie et jeter une proposition juste priverait Marc du bouton),
  **strict sur le FOND** : une place hors de 1-4 ne produit AUCUNE carte et le marqueur reste
  du texte. Un bouton vers la cinquième place d'une semaine qui en compte quatre est une
  promesse creuse.
  ⚠️ **Les places se disent de 1 à 4, la base compte de 0**, et `positionEnBase` est le SEUL
  endroit où la conversion se fait. Un décalage d'un cran remplacerait silencieusement une
  recette que Marc voulait garder.
  ⚠️ **La composition « 3 plats + 1 dessert » peut être cassée, mais jamais en silence**
  (arbitrage de Marc) : le clic VAUT demande explicite, donc la carte affiche l'avertissement
  AVANT — elle ne peut valoir demande explicite que si Marc sait ce qu'il demande. Le serveur
  ne refuse pas le rôle ; il refuse une place inexistante et une recette absente du catalogue,
  parce que l'identifiant vient d'un modèle et que la Server Action est un point d'entrée POST
  atteignable sans passer par le chat.
  ⚠️ **L'outil `lire_semaine` LIT, il ne fabrique jamais.** `semaineCourante` crée la
  proposition quand elle manque (delete + insert) : appelée depuis un outil, elle fabriquerait
  la semaine de Marc au détour d'une question et effacerait la précédente. Même règle que pour
  le hub, pour la même raison.
  ⚠️ **Le prompt et le parseur doivent parler du MÊME marqueur**, et leur divergence ne lève
  RIEN — l'assistant répond bien, aucun bouton n'apparaît jamais. `tests/semaineAssistant.test.ts`
  extrait le gabarit ÉCRIT dans le prompt et le fait parser pour de vrai.
  ⚠️ **Regénérer la semaine entière change de GRAINE** (`${semaine}:regen:${Date.now()}`) :
  `choisirQuatre` est déterministe par conception, donc rejouer sur la graine de la semaine
  rendrait les quatre mêmes recettes et le bouton aurait l'air cassé. Le retrait et la pose
  sont dans la même transaction, et l'écran demande une CONFIRMATION — un clic qui efface
  quatre choix faits un par un mérite un second geste.
- **Fonctions pures testées** pour la logique (agrégation, mise à l'échelle, prix, jetons,
  ingrédients de fond, protocole de l'assistant).
- **Planchers de version, jamais redescendus.** `drizzle-orm ≥ 0.45.2` (injection SQL par
  identifiants mal échappés, GHSA-gpj5-g38j-94v9, HIGH), et les `overrides` de `postcss` et
  `sharp` qui ferment des failles que Next épingle lui-même. *Verrou* :
  `web/tests/dependances.test.ts` — il inspecte **toutes** les copies du lockfile, pas
  seulement la racine (Next embarquait sa propre `postcss` 8.4.31 dans son `node_modules`,
  vulnérable et invisible depuis le premier niveau). Discrimination prouvée. Retirer un
  `override` seulement après avoir mesuré `npm audit --omit=dev` → 0.

