# BatchChef web

Planificateur de batch cooking québécois, **100 % en ligne** : Next.js (Vercel) +
Neon Postgres + LLM. Zéro Celery/Redis/Playwright, zéro scraping anti-bot. Les prix
d'épicerie sont **estimés** (LLM + filet déterministe, couverture 100 %) — jamais de
scan de reçus ni de prix « réels » relevés.

## Ce que fait la Phase 1

- **Bibliothèque de recettes** : colle l'URL d'une recette (n'importe quel site) → un
  LLM extrait titre, portions, ingrédients aux unités normalisées (g/ml/unité),
  instructions. Validation Zod stricte : un parse douteux est rejeté, jamais inséré sale.
- **Import depuis une vidéo** (reel Instagram, TikTok, Short) : dépose la vidéo — en pratique
  un **enregistrement d'écran** du reel, légende dépliée → images extraites **dans le
  navigateur** (`<video>` + `<canvas>`, zéro dépendance) puis lues par un modèle vision, qui
  rend ingrédients et préparation détaillée. Même écran de validation que l'import par URL.
  Détails plus bas.
- **Batchs** : choisis tes recettes + portions → liste d'épicerie agrégée
  (mise à l'échelle, regroupement par ingrédient, jamais deux unités mélangées).
- **Liste d'épicerie mobile** : plein écran téléphone, grosses cases, cochage optimiste
  qui tolère le réseau d'épicerie (échec → la case revient + bandeau).
- **Budget** : chaque article reçoit un coût **estimé** (LLM à Québec en CAD, taxes
  exclues) ; un filet déterministe garantit qu'aucun article ne reste sans prix
  (couverture 100 %). Ce sont des estimations, pas des prix relevés.
- **Privé** : login Google mono-adresse (pattern du hub perso), middleware fail-closed.

## Démarrage

```bash
cd web
npm install
cp .env.example .env.local   # puis remplis les valeurs (voir ci-dessous)
npm run db:migrate           # applique drizzle/ sur la base Neon
npm run dev
```

### Configuration (une fois)

1. **Neon** (base Postgres gratuite) : https://neon.tech → nouveau projet →
   copie la *connection string* (pooled) dans `DATABASE_URL`.
2. **Google OAuth** : Google Cloud Console → ton client OAuth « Web application »
   (le même projet que le hub fait l'affaire) → ajoute les redirect URIs listés dans
   `.env.example` → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
3. `AUTH_SECRET` : `npx auth secret`. `AUTHORIZED_EMAIL` : ton adresse.
4. **Anthropic** : `ANTHROPIC_API_KEY` (parse des recettes + estimations).

### Déploiement Vercel

Nouveau projet Vercel → ce repo → **Root Directory = `web`** → colle les variables
d'env ci-dessus → Deploy. C'est tout (pas de worker, pas de base à héberger toi-même).

**Migrations automatiques** : le script `vercel-build` (que Vercel utilise à la place de
`build` s'il est présent) lance `db:migrate` avant `next build`, à CHAQUE déploiement
(prod et previews). Rien à lancer à la main sur ta machine après un changement de schéma —
`git push` suffit. Idempotent : une migration déjà appliquée est ignorée (table de suivi
Drizzle), donc plusieurs déploiements qui se chevauchent ne rejouent rien deux fois.

## Partager un reel vers BatchChef (Android)

BatchChef s'installe comme une app (PWA) et apparaît alors dans la **feuille de partage**
d'Android.

**Installation** : ouvre BatchChef dans Chrome → menu ⋮ → **« Install »** (pas « Create
shortcut » / « Ajouter à l'écran d'accueil », qui ne crée qu'un raccourci incapable de
recevoir un partage). Ouvre l'app une fois ensuite, pour que le service worker s'active.

⚠️ **Instagram ne partage jamais le fichier vidéo à une autre app** — « Partager → autre
application » n'envoie qu'une **URL**, sans la légende. Et l'app **ne va rien chercher** chez
Instagram (garde-fou du projet, et de toute façon le téléchargement d'un reel tiers n'est
autorisé ni par leurs conditions ni par aucune API Meta).

**La voie normale est donc l'enregistrement d'écran**, parce qu'un seul fichier porte tout :

1. Lance l'enregistreur d'écran d'Android, reviens sur le reel, **déplie la légende** et
   laisse-la lisible quelques secondes, puis laisse la vidéo tourner une fois en entier.
2. Arrête l'enregistrement, puis **Partager → BatchChef** depuis la Galerie.

L'analyse démarre toute seule, la légende est lue **dans** l'enregistrement comme le reste, et
tu n'as rien à copier. Les deux autres entrées restent disponibles en repli : des **captures
d'écran** (jusqu'à 8, lues par le modèle vision) et la **description collée** (bouton
« Coller » du formulaire).

**Priorité du budget** : les captures d'écran passent avant les images de la vidéo. Elles
portent les quantités écrites, alors qu'une image de vidéo ne montre souvent qu'un geste —
sacrifier une capture pour garder une douzième casserole reviendrait à jeter la recette.

**Ce que le partage a transmis** : l'écran `/partage` affiche les champs bruts reçus
(`title`, `text`, `url`, fichiers). Ce que chaque app y met n'est documenté nulle part —
ce bloc rend la question mesurable au lieu de supposée.

**Comment ça marche techniquement.** Le manifeste déclare une `share_target` en POST
multipart vers `/partage`. Un **service worker** (`public/sw.js`) intercepte ce POST *dans
le navigateur*, range la vidéo dans le Cache Storage et redirige vers `/partage` en GET ;
la page relit le cache côté client.

⚠️ Le worker n'intercepte que les **navigations** (`request.mode === "navigate"`), et c'est
vital : une Server Action de Next poste vers l'URL de la page courante, donc vers `/partage`
quand l'analyse tourne sur cet écran. Sans cette condition, le worker avale la requête
d'analyse et répond une redirection — le navigateur affiche « An unexpected response was
received from the server » et rien n'apparaît dans les journaux du serveur, puisque la
réponse n'a jamais quitté le téléphone. Conséquence : **la vidéo ne transite jamais par le
serveur**, exactement comme pour un dépôt manuel. Le worker ne met rien d'autre en cache —
pas de mode hors-ligne, parce que les écrans de BatchChef affichent des données
personnelles derrière une session.

⚠️ **iOS n'est pas couvert** : Safari ne permet pas à une PWA de s'inscrire dans la feuille
de partage. Sur iPhone, il faut passer par le formulaire de `/recettes`.

## Import depuis une vidéo (reel Instagram & co)

Sur `/recettes`, le bloc « Depuis une vidéo » prend trois entrées, toutes indépendantes :

| Entrée | Rôle |
|---|---|
| Lien du reel | facultatif — devient la `sourceUrl` de la recette. **Rien n'est téléchargé depuis ce lien.** |
| Vidéo (fichier) | en pratique l'**enregistrement d'écran** — lue localement, jamais téléversée |
| Captures d'écran | repli quand il n'y a pas d'enregistrement — images de texte, lues mot à mot |
| Description publiée | facultative : utile quand la légende est copiable |

Il faut au moins une image (vidéo ou capture) **ou** la description (garde rejouée côté serveur).

**Pourquoi Marc fournit le contenu au lieu que l'app aille le chercher.** Instagram interdit
l'aspiration de ses pages et la bloque activement ; le principe « pas de scraping » du projet
s'applique tel quel. L'app ne fait donc aucune requête vers Instagram : Marc, lui, a
légitimement accès au contenu via son compte.

**Comment la vidéo est lue.** L'API Anthropic ne prend pas de vidéo : le navigateur en tire
des images (`lib/video/`), en **deux passes**.

1. **Repérage** — une sonde par seconde (plafond 90, l'intervalle s'élargit au-delà), réduite
   à 32×32, dont on ne garde qu'une **empreinte** de 64 valeurs de gris. Aucun encodage JPEG
   ici : c'est ce qui rend cette densité abordable sur un téléphone.
2. **Extraction** — on ne revient chercher en pleine résolution (768 px, JPEG) que les
   **écrans distincts**, au plus 12.

Pourquoi cette densité. L'échantillonnage régulier d'avant prenait ~12 images réparties sur la
durée, soit une toutes les 3 à 4 s sur un reel de 30 à 45 s : une carte « 250 g de beurre »
affichée 2 s n'avait qu'**une chance sur deux** d'être vue. Le fichier contenait la quantité,
l'échantillonnage la manquait. À une sonde par seconde, une carte de 2 s est vue deux fois.

Le tri par empreinte est ce qui permet de sonder densément sans envoyer douze photos du même
plan de travail : un écran figé ne part qu'une fois, et le budget va aux écrans qui apportent
quelque chose. La comparaison se fait avec la dernière image **gardée**, pas avec la
précédente — sur une légende qu'on fait défiler lentement, comparer de proche en proche ne
garderait qu'une seule image de tout le texte (verrouillé par `tests/video.test.ts`, preuve
par mutation).

Seules les images retenues partent au serveur, sous un plafond de 3 Mo revérifié côté serveur
(la limite serverless Vercel est à 4,5 Mo). Si des images doivent être écartées faute de
place, elles sont **comptées et affichées** — jamais coupées en silence. L'écran de validation
dit les trois nombres : instants sondés, écrans distincts, images envoyées.

**L'audio est transcrit** (depuis le 13/08/2026). La piste sonore est extraite **dans le
navigateur** (`lib/audio/`), ramenée à 16 kHz mono — le format que Whisper consomme — et
envoyée en WAV à `POST /api/transcription`, qui appelle Groq. La vidéo, elle, ne monte
toujours pas : ce qui part est ~32 Ko par seconde d'audio, borné à **2 minutes** (au-delà,
la requête dépasserait la limite de 4,5 Mo d'une fonction Vercel — la troncature est alors
**affichée**, jamais silencieuse).

⚠️ **La transcription est la source la MOINS fiable, et le prompt le dit explicitement.**
La reconnaissance vocale se trompe surtout sur les nombres et les unités, c'est-à-dire
exactement ce qui compte. Elle ne peut donc jamais contredire un texte lu à l'écran ou la
description : elle sert à **compléter** ce qu'aucun écrit ne dit. Une quantité entendue mais
incertaine devient `qty: null` — « au goût » honnête plutôt qu'un nombre mal compris qui
entrerait dans la liste d'épicerie sans que rien ne le signale.

Sans `GROQ_API_KEY`, tout fonctionne comme avant et l'écran de validation affiche
« transcription non configurée » : une intégration éteinte n'est pas une panne, et les deux
se distinguent à l'écran. Un échec réel affiche le motif rendu par le fournisseur.

**Portions.** Un reel annonce rarement « pour 4 personnes ». Quand la source ne dit rien, la
valeur reste 4 mais l'écran de validation l'affiche comme un **défaut à corriger**, pas comme
une donnée — toutes les quantités de la liste d'épicerie en dépendent.

**Le lien de la source se saisit à l'écran de validation.** Un partage depuis la Galerie
(l'enregistrement d'écran) n'apporte aucune URL, et le démarrage automatique saute le
formulaire : le champ vit donc sur l'écran de validation, avec un bouton **« Coller »** pour
l'adresse du reel copiée depuis Instagram. Il est enregistré avec la recette pour pouvoir
revoir la vidéo plus tard — **rien n'est téléchargé depuis ce lien**. Comme il est
désormais éditable, il est revalidé côté serveur (`normaliserLienSource`) : http/https
uniquement, parce qu'il devient un `<a href>` sur la page de recette.

**Provenance.** La bibliothèque mélange deux choses : les recettes que tu as apportées
(vidéo, page web) et celles piochées dans le catalogue. La colonne `origine` les distingue,
et la page de recette l'affiche avec la date d'ajout — « Ajoutée par toi, depuis une vidéo ·
13 août 2026 ». Les recettes créées avant cette colonne affichent « Origine non
enregistrée » : on ne devine pas une provenance qu'on n'a pas enregistrée. La date est
rendue dans le fuseau du Québec, pas celui du serveur.

**Modèle et coût.** La lecture d'images tourne sur un modèle vision
(`BATCHCHEF_LLM_MODEL_VISION`, défaut `claude-sonnet-5`) alors que le parse texte reste sur
Haiku (`BATCHCHEF_LLM_MODEL`). Le coût publié au hub applique le tarif **du modèle
réellement appelé** (`lib/llmUsage.ts`) : de l'ordre de 1 à 2 ¢ par vidéo.

## Catalogue de découverte (les 10 188 recettes de la V3)

Un écran `/catalogue` cherchable, séparé de ta bibliothèque perso : tu y piges des idées
et tu ajoutes ce qui t'intéresse (une ou plusieurs d'un coup). Peuplé une fois depuis la
base seed committée (`web/data/batchchef.seed.db`), unités normalisées à l'import :

```bash
cd web
DATABASE_URL='TON_URL_NEON' npm run db:migrate      # applique aussi la table catalogue (0001)
DATABASE_URL='TON_URL_NEON' npm run catalog:import   # importe les 10 188 recettes (~1-2 min)
```

Relançable sans risque (vide d'abord le catalogue). Ne touche jamais ta bibliothèque ni tes batchs.

## Vérifications avant commit

```bash
npm run typecheck && npm run test && npm run build
```

## Intégration hub

Endpoint `GET /api/hub/summary` (gardé par jeton `x-hub-token`) : le hub perso
(hubperso) affiche un widget BatchChef (recettes, batchs actifs, articles à acheter,
budget). Voir `lib/hubSummary.ts`.

## Serveur MCP — brancher Claude sur BatchChef

Endpoint `POST /api/mcp` : un Claude **extérieur** (Claude Code, app Claude) peut fouiller
les recettes et le catalogue, lire une liste d'épicerie, **et écrire** — créer un batch,
copier une recette du catalogue vers la bibliothèque, cocher un article. C'est l'ADR-0001 ;
l'assistant intégré (`/assistant`) reste séparé, il vit dans l'app.

### 1. Poser le jeton (une fois)

Générer une chaîne aléatoire et la poser dans les variables d'environnement Vercel sous
`MCP_TOKEN` (jamais dans le dépôt) :

```bash
openssl rand -base64 32
```

Tant qu'elle est absente, la route répond **503 « MCP_TOKEN non configuré »** : l'intégration
est éteinte, ce n'est pas une panne.

### 2. Déclarer le serveur dans Claude Code

```bash
claude mcp add --transport http batchchef https://batchchef.hubperso.com/api/mcp \
  --header "Authorization: Bearer <le jeton>"
```

⚠️ **Le domaine compte : `batchchef.hubperso.com`, JAMAIS une URL `*.vercel.app`.** Le projet
a la protection Vercel (SSO) activée en mode `all_except_custom_domains` — vérifié le 19/08.
Les URLs `*.vercel.app` (préversions **et** alias de production) répondent donc **302 vers
`vercel.com/sso-api`** *avant* que l'app ne tourne : le client MCP ne verrait jamais le
JSON-RPC, et rien dans la réponse ne lui dirait pourquoi. Seuls les domaines personnalisés
sont exemptés.

### 3. Vérifier que ça répond

```bash
curl -s -X POST https://batchchef.hubperso.com/api/mcp \
  -H "Authorization: Bearer <le jeton>" -H 'Content-Type: application/json' \
  --data-binary '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Sept outils doivent revenir. Les réponses se distinguent : **503** = jeton non configuré côté
serveur, **401** = jeton absent ou faux côté appelant, **405** = ce n'est pas un POST.

### Les sept outils

| Outil | Effet |
|---|---|
| `batchchef_chercher_recettes` | cherche par ingrédients (dit ce qui est couvert et ce qui manque) et/ou par titre |
| `batchchef_lire_recette` | ingrédients avec quantités, et préparation |
| `batchchef_lister_batchs` | batchs, statuts, recettes, budget estimé |
| `batchchef_lire_liste_epicerie` | articles d'un batch, ce qui est pris, montant restant |
| `batchchef_creer_batch` | **écrit** — crée un batch et sa liste d'épicerie |
| `batchchef_ajouter_recette_du_catalogue` | **écrit** — copie des recettes du catalogue vers la bibliothèque |
| `batchchef_cocher_article` | **écrit** — marque un article pris (ou non) |

L'import d'une recette **depuis une URL n'est pas exposé**, volontairement : il
court-circuiterait l'écran de validation, et la règle du projet est « le LLM propose, le code
valide, Marc confirme ».

⚠️ **Non vérifié** : le branchement depuis l'interface de connecteurs de **claude.ai**, qui
peut exiger un flux OAuth 2.1 là où un jeton porteur suffit à Claude Code. À constater au
premier essai, pas à supposer.
