# CLAUDE.md — BatchChef

Planificateur de batch cooking québécois, **100 % en ligne**. Toute l'app vit dans `web/`.

- **Next.js 15** (App Router, Server Components + Server Actions), **Vercel**.
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
- **Tailwind v4**, **Zod**, **vitest**.

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
  dans le catalogue de 10 188 recettes, et une origine absente rend « Origine non
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
- **Fonctions pures testées** pour la logique (agrégation, mise à l'échelle, prix, jetons,
  ingrédients de fond, protocole de l'assistant).
- **Planchers de version, jamais redescendus.** `drizzle-orm ≥ 0.45.2` (injection SQL par
  identifiants mal échappés, GHSA-gpj5-g38j-94v9, HIGH), et les `overrides` de `postcss` et
  `sharp` qui ferment des failles que Next épingle lui-même. *Verrou* :
  `web/tests/dependances.test.ts` — il inspecte **toutes** les copies du lockfile, pas
  seulement la racine (Next embarquait sa propre `postcss` 8.4.31 dans son `node_modules`,
  vulnérable et invisible depuis le premier niveau). Discrimination prouvée. Retirer un
  `override` seulement après avoir mesuré `npm audit --omit=dev` → 0.

## 2. Conventions de code

- Réponses, commits et docs **en français** (`feat:`, `fix:`, `docs:`…).
- TypeScript strict, pas de `any` silencieux. Erreurs honnêtes, jamais avalées.
- Pas d'emoji dans l'UI ni les docs (sauf demande explicite).

### Structure `web/`

| Chemin | Rôle |
|---|---|
| `app/` | routes (recettes, batchs, courses, catalogue, `/api/hub/summary`, `/api/mcp`) |
| `lib/actions.ts` | Server Actions (import, batch, liste, statut, catalogue) |
| `lib/aggregate.ts` | agrégation liste d'épicerie, mise à l'échelle, filet de prix (purs) |
| `lib/ingredientsDeFond.ts` | sel/poivre/eau écartés de la liste — automatique, mot à mot, et DIT à l'écran (PUR, testé) |
| `lib/assistant/` | `protocole.ts` = bornes, troncature, classement, balisage (PUR, testé) · `outils.ts` = ce que Claude peut interroger · `boucle.ts` = les allers-retours |
| `lib/mcp/` | `protocole.ts` = JSON-RPC + négociation de version (PUR, testé) · `declarations.ts` = les 7 outils ANNONCÉS (données pures, testables sans next-auth) · `outils.ts` = ce qui les EXÉCUTE. La correspondance des deux derniers est verrouillée dans les DEUX sens |
| `lib/llm/` | parse de recette (page web **et** vidéo) + estimation de coûts (Zod, honnête) |
| `lib/video/` | `frames.ts` = sondage/empreintes/budget (PUR, testé) · `capture.ts` = extraction `<video>`+`<canvas>` en 2 passes (repérage 32×32 puis extraction 768 px) **dans le navigateur** (la vidéo ne monte jamais au serveur) |
| `lib/partage.ts` + `public/sw.js` | cible de partage Android (PWA). Le service worker intercepte le POST **côté navigateur** : la vidéo partagée ne transite pas par le serveur |
| `lib/db/` | schéma Drizzle + connexion Neon paresseuse |
| `lib/hubSummary.ts` | résumé conforme `@mokarade/hub-contract` (widget hub perso) |
| `data/batchchef.seed.db` | base seed du catalogue (10 188 recettes) |

### Direction visuelle (décision de Marc, 13/08/2026)

**Identité d'app de cuisine, pas de tableau de bord.** Les deux écrans les plus utilisés —
la liste d'épicerie et une recette — se lisent DEBOUT, une main occupée, parfois sous les
néons d'un supermarché.

- **Les couleurs vivent dans `app/globals.css`, en variables, et NULLE PART ailleurs.** Le
  vocabulaire est `.carte` / `.bouton` / `.champ` / `.doux` / `.succes` / `.alerte` /
  `.erreur` (+ `.sur-accent`, `.texte-succes`, `.texte-erreur` pour du texte sans fond).
  Avant, 288 chaînes de classes recopiées réinventaient bordures et gris d'un écran à
  l'autre : c'est ce qui faisait dériver l'ensemble à chaque page ajoutée.
  ⚠️ **Une couleur figée est INVISIBLE à la relecture** : elle est parfaitement lisible dans
  le thème pour lequel on l'a écrite. Vécu le 14/08/2026 — ma passe de refonte a remplacé
  les variantes `dark:bg-stone-900` par des jetons en LAISSANT le `bg-white` en dur qu'elles
  corrigeaient : 21 endroits, fond blanc figé sous un texte clair hérité en thème sombre,
  zéro test rouge, zéro erreur. C'est Marc qui l'a vu sur son téléphone. Un remplacement
  ordonné qui supprime le correctif AVANT l'original laisse toujours ce trou-là.
  *Verrou* : `web/tests/theme.test.ts` — il refuse toute classe de palette Tailwind dans
  `app/`/`components/`/`lib/`, toute variante appliquée au vocabulaire maison
  (`dark:texte-erreur` ne génère rien) ou vide (`dark:` seul), tout `var(--jeton)` inexistant,
  et toute couleur définie en clair mais oubliée en sombre. Portée = `git ls-files` **+** le
  neuf non ignoré (sinon le garde arrive un commit trop tard) ; l'unique exception est
  NOMMÉE classe par classe (la case posée sur une photo, dont le contraste se joue contre
  l'image). Discrimination prouvée par quatre mutations, une par test.
  ⚠️ **Le CSS servi n'est PAS le bon endroit où vérifier.** Tailwind v4 balaie tout le dépôt,
  commentaires et Markdown compris : la prose qui raconte ce bug génère des règles
  `.bg-white` / `.dark\:bg-stone-900` que plus aucun balisage n'utilise. Inerte, mais ça
  ressemble à une rechute. Ce qui tranche est le **HTML servi** (la classe rendue), pas la
  présence d'une règle dans la feuille.
- **L'accent (`--accent`) ne sert QU'À l'action principale.** Ailleurs, il ment sur ce qui
  est cliquable.
- **Navigation en bas sur téléphone** (`components/Navigation.tsx`), en haut à partir de
  `sm`. `estOngletActif` est pure et testée — un onglet allume sa SECTION, `/` est traité à
  part. ⚠️ `env(safe-area-inset-bottom)` + `viewportFit: "cover"` : sans eux la barre passe
  sous la barre de gestes d'Android.
- **Cibles tactiles ≥ 44 px, champs à 16 px** (en dessous, iOS zoome tout seul).
- ⚠️ **Pas de police téléchargée.** `next/font/google` va chercher les fichiers AU BUILD :
  dépendance réseau au déploiement, et tout build hors ligne casse. Les piles système
  donnent déjà le contraste serif (titres) / sans (texte).

## 3. Workflow git

Branche `claude/<slug>` → commits en français → push → PR → **Claude merge lui-même**
(squash sur `master`), sans demander. Le gate local + la CI sont les filets ; le merge n'est
pas un point de décision de Marc. Corollaire : tout ce qui doit partir avec le lot (doc,
tests, leçons) est committé AVANT le merge — une PR mergée ne se rattrape pas.

⚠️ Après un squash-merge, GitHub supprime la branche : repartir de `master`
(`git fetch origin master && git checkout -B <branche> origin/master`) avant la tâche
suivante, jamais empiler sur l'historique déjà mergé.

- ⚠️ **`git fetch origin master` AVANT de committer.** Plusieurs sessions travaillent en
  parallèle sur l'écosystème ; le 20/08/2026, deux d'entre elles ont produit la même
  correction, mot pour mot, dans la même heure.

## 4. Commandes utiles

```bash
cd web
npm run dev        # http://localhost:3000
npm run test       # vitest
npm run typecheck  # tsc --noEmit
npm run build      # build de production
```

## 5. Vérifications avant commit

```bash
cd web && npm run typecheck && npm run test && npm run build
```

Et, après toute modification de dépendances : `npm audit --omit=dev` doit rendre **0**.
Les quelques avis `moderate` restants sont **dev-only** (chaîne `esbuild` → `drizzle-kit`,
serveur de développement) : ils ne touchent pas la production et `npm audit fix --force`
proposerait de rétrograder Next en 9.x, ce qui casserait l'app.

⚠️ La branche par défaut du dépôt est **`master`**, pas `main` — `main` est une vieille
branche abandonnée qui a divergé. Repartir de `master`.

## 6. Après un merge : vérifier le DÉPLOIEMENT, pas seulement la CI

**CI verte ne veut pas dire « en ligne ».** Ce sont deux systèmes indépendants : la CI
juge le code, Vercel construit et sert. Un merge peut passer le gate et ne jamais être
déployé — la branche reste verte, le site continue de servir l'ancien build, et rien
n'est rouge nulle part.

Vécu le 31/07/2026 : quatre projets Vercel ont cessé de créer des déploiements pendant
~3 h (l'intégration Git n'a rien reçu). DriveAI et JobAI ont rattrapé au push suivant ;
BatchChef et Hubperso n'en ont pas eu — leur commit d'en-têtes de sécurité est resté
**cinq jours** en attente sans que personne ne le voie. BatchChef servait toujours des
réponses sans aucun en-tête de sécurité alors que la PR était mergée.

Donc, après un merge qui change ce qui est servi (en-têtes, `next.config.ts`,
middleware, variables de build) : vérifier qu'un déploiement de production a bien été
créé et qu'il est `READY`, puis **contrôler l'effet sur la réponse HTTP réelle** — un
en-tête se lit dans la réponse, il ne se déduit pas du fichier source.

⚠️ **Un merge peut produire ZÉRO déploiement, sans que rien ne soit rouge.** Vécu le
13/08/2026 : le quota partagé étant épuisé, le merge de la PR #42 n'a créé aucun build. La
CI était verte, la PR mergée, `master` à jour — et la production servait toujours le commit
précédent. La vérification n'est donc pas « le déploiement a-t-il réussi ? » mais d'abord
« existe-t-il ? ».

⚠️ **Et le rattrapage n'est PAS « Redeploy ».** Redeploy rejoue le commit du déploiement
EXISTANT, pas le dernier commit de `master` : sur un commit qui n'a jamais été déployé, il
n'y a rien à rejouer, et rejouer le voisin reconstruirait l'ancien code (leçon JobAI, même
famille). Le seul déclencheur fiable est un NOUVEAU push sur `master`. Attention alors à
l'`ignoreCommand` : un commit qui ne touche que `*.md` ou `web/tests/*` serait ignoré — le
commit de rattrapage doit toucher un fichier hors exemptions.

Corollaire : un merge qui ne change QUE de la doc n'a pas de déploiement à vérifier. Le dire
plutôt que de laisser croire qu'on a vérifié.

### ⚠️ Une PRÉVERSION écrit dans la base de PRODUCTION

Il n'y a qu'une base Neon, et `vercel-build` fait `db:migrate` (puis `db:reparer-ingredients`)
**avant** `next build`. Or Vercel construit aussi chaque préversion. Donc **toute migration
et tout script de données d'une branche s'appliquent à la production dès le premier build de
la PR — avant tout merge, avant toute revue.**

Constaté le 19/08 : la réparation des noms (`ING-03`) avait déjà traité 16 870 lignes de
production quand j'ai lu les logs de la PRÉVERSION. Sans conséquence ici — la passe est
idempotente, non destructive, et c'était le correctif voulu — mais le mécanisme, lui, ne
distingue pas.

Ce n'est pas nouveau (`db:migrate` y était depuis toujours) ; c'est simplement rarement
visible. Deux règles qui en découlent :

1. **« On essaiera d'abord sur une branche » est FAUX ici.** Une migration destructive
   (suppression de colonne, réécriture de données) touche la production au premier push.
   Faire valider par Marc AVANT de pousser, pas avant de merger.
2. Un script de données dans `vercel-build` doit être **idempotent**, **non destructif**, et
   **tracer ce qu'il a fait** — sinon on ne peut même pas savoir, après coup, ce qu'une
   préversion a modifié.

## 7. Intégration hub

- BatchChef publie `GET /api/hub/summary` conforme à `@mokarade/hub-contract`, gardé par le
  jeton `x-hub-token`. Voir `lib/hubSummary.ts`.
- ⚠️ **`HUB_TOKEN` sert dans LES DEUX SENS.** Entrant : le hub le présente pour lire le
  summary. **Sortant** : BatchChef le présente au hub sur `POST /api/acces`
  (`web/lib/accesHub.ts`) pour demander qui a le droit d'entrer. C'est le MÊME secret, et
  c'est lui qui IDENTIFIE BatchChef côté hub — aucun `appId` n'est envoyé dans le corps,
  sinon une app pourrait interroger les accès d'une autre.
- ⚠️ **`NEXT_PUBLIC_HUB_URL` n'est pas décoratif** : `web/lib/accesHub.ts` s'en sert comme
  base de `POST /api/acces`. La pointer ailleurs coupe l'accès de tout le monde sauf le
  propriétaire, **silencieusement** (échec fermé → `false`).
- **BatchChef garde son fournisseur Google**, contrairement à JobAI et CarAI. Ce qui vient du
  hub, c'est l'**autorisation**, pas l'authentification.
- **Période des coûts** : `total`. Le hub somme PAR période et ne fusionne jamais « cumulé »
  avec « ce mois-ci » — une app qui publierait `mois` se retrouverait seule dans sa colonne.

## 8. Documentation (où vit quoi)

- **`HANDOVER.md`** — état courant, **à lire en premier** à chaque reprise.
- `BACKLOG.md` — tâches, chacune avec sa case, cochée au merge. ⚠️ Un item peut être périmé.
- `docs/LESSONS.md` — ce qui a été appris en le vivant · `docs/adr/` — décisions verrouillées.

⚠️ Doc périmée = pire que pas de doc.

| Fichier | Contenu |
|---|---|
| `README.md` · `web/README.md` | À quoi sert l'app, pour un lecteur extérieur. |
| `CLAUDE.md` | Ce fichier. Se charge à **chaque session** → il reste **court**. |
| `HANDOVER.md` | L'état RÉEL : ce qui tourne, ce qui reste à poser. À lire en premier. |
| `BACKLOG.md` | Ce qui est décidé mais pas fait. |
| `docs/adr/` | Décisions architecturales, `NNNN-slug.md`. |
| `docs/LESSONS.md` | Les leçons détaillées. Elles vont là, pas dans ce fichier. |

⚠️ **Doc périmée = pire que pas de doc.** Le 19/08/2026, trois fichiers annonçaient encore un
« login Google mono-adresse » alors qu'`web/auth.ts` a deux étages depuis l'étape 2 — et le
commentaire d'`auth.ts` disait déjà l'inverse, en toutes lettres. Mettre à jour la doc touchée
dans la MÊME PR que le code.

⚠️ **Un chiffre au présent rote.** `docs/LESSONS.md` cite ses nombres de tests dans des récits
**datés** : c'est le bon usage, à garder.

## 9. Leçons apprises

Elles vivent dans [`docs/LESSONS.md`](./docs/LESSONS.md) — ce fichier se charge à chaque
session, elles n'y tiendraient pas. Les ADR sont dans [`docs/adr/`](./docs/adr/).

## 10. Style et compte-rendu

> 📣 Forme des comptes-rendus, des commits, des PR et des docs générées :
> [convention commune aux neuf dépôts](https://github.com/MoKarade/claude-config/blob/main/conventions/COMPTE-RENDU.md).
> Elle régit **la forme** ; ce fichier garde **le contenu métier**. Sur la forme, c'est la
> convention qui gagne ; sur le métier, c'est ce fichier.

@docs/COMPTE-RENDU.md

⚠️ **Pourquoi une COPIE et pas seulement un lien.** Un `CLAUDE.md` ne charge rien hors de son
propre arbre : le lien ci-dessus est lisible par un humain, il n'arrive jamais dans la session.
C'est exactement le mode de panne du 20/08/2026 — les règles de cadrage écrites dans un
`~/.claude/CLAUDE.md` local ne descendaient nulle part, et Marc constatait « je ne vois pas la
différence » alors que rien n'était jamais arrivé. `docs/COMPTE-RENDU.md` est donc une copie
**synchronisée**, importée ci-dessus, et la CI échoue si elle a dérivé de la source.

Pour changer la convention : la changer dans `claude-config`, propager les huit copies, mettre
à jour les huit empreintes. La friction est le garde-fou — une copie qu'on peut modifier sur
place redevient huit conventions différentes en trois mois.

