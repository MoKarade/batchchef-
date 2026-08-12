# BatchChef web

Planificateur de batch cooking québécois, **100 % en ligne** : Next.js (Vercel) +
Neon Postgres + LLM. Zéro Celery/Redis/Playwright, zéro scraping anti-bot. Les prix
d'épicerie sont **estimés** (LLM + filet déterministe, couverture 100 %) — jamais de
scan de reçus ni de prix « réels » relevés.

## Ce que fait la Phase 1

- **Bibliothèque de recettes** : colle l'URL d'une recette (n'importe quel site) → un
  LLM extrait titre, portions, ingrédients aux unités normalisées (g/ml/unité),
  instructions. Validation Zod stricte : un parse douteux est rejeté, jamais inséré sale.
- **Import depuis une vidéo** (reel Instagram, TikTok, Short) : dépose la vidéo et/ou colle
  la description publiée → images extraites **dans le navigateur** (`<video>` + `<canvas>`,
  zéro dépendance) puis lues par un modèle vision, qui rend ingrédients et préparation
  détaillée. Même écran de validation que l'import par URL. Détails plus bas.
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
d'Android. Une fois installée :

1. Sur le reel → **Enregistrer la vidéo** (elle va dans la galerie).
2. Galerie → **Partager** → **BatchChef**.
3. L'app s'ouvre, lit la vidéo et propose la recette. Tu relis, tu enregistres.

**Installation** : ouvre BatchChef dans Chrome → menu ⋮ → « Installer l'application ».

⚠️ **Instagram ne partage jamais le fichier vidéo à une autre app** — « Partager → autre
application » n'envoie qu'une **URL**. C'est pour ça que l'étape « Enregistrer la vidéo »
existe. Un partage direct depuis Instagram fonctionne quand même : BatchChef reçoit le lien,
te le dit franchement, et te demande de coller la description (appui long sur la légende du
reel → Copier) — ce qui suffit dans la majorité des cas.

**Comment ça marche techniquement.** Le manifeste déclare une `share_target` en POST
multipart vers `/partage`. Un **service worker** (`public/sw.js`) intercepte ce POST *dans
le navigateur*, range la vidéo dans le Cache Storage et redirige vers `/partage` en GET ;
la page relit le cache côté client. Conséquence : **la vidéo ne transite jamais par le
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
| Vidéo (fichier) | facultative — lue localement, jamais téléversée |
| Description publiée | facultative mais **recommandée** : c'est là que sont les quantités |

Il faut au moins la vidéo **ou** la description (garde rejouée côté serveur).

**Pourquoi Marc fournit le contenu au lieu que l'app aille le chercher.** Instagram interdit
l'aspiration de ses pages et la bloque activement ; le principe « pas de scraping » du projet
s'applique tel quel. L'app ne fait donc aucune requête vers Instagram : Marc, lui, a
légitimement accès au contenu via son compte.

**Comment la vidéo est lue.** L'API Anthropic ne prend pas de vidéo. Le navigateur extrait
4 à 12 images réparties sur toute la durée (`lib/video/`), réduites à 768 px et encodées en
JPEG ; seules ces images partent au serveur, sous un plafond de 3 Mo revérifié côté serveur
(la limite serverless Vercel est à 4,5 Mo). Si des images doivent être écartées faute de
place, elles sont **comptées et affichées** — jamais coupées en silence, et la sélection reste
répartie sur la durée plutôt que tronquée au début.

⚠️ **L'audio n'est pas transcrit.** Une recette dite uniquement à l'oral, sans texte à
l'écran ni description, ne sera pas récupérée intégralement. C'est la limite assumée : il
n'existe pas de transcription gratuite côté serveur dans cette stack.

**Portions.** Un reel annonce rarement « pour 4 personnes ». Quand la source ne dit rien, la
valeur reste 4 mais l'écran de validation l'affiche comme un **défaut à corriger**, pas comme
une donnée — toutes les quantités de la liste d'épicerie en dépendent.

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
