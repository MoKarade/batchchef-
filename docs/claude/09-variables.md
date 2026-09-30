# 09 — Variables d'environnement : requises, optionnelles, conséquence si absente

Noms seulement, jamais de valeur. Le rôle détaillé et la façon d'obtenir chaque valeur :
`web/.env.example`. Inventaire fait le 30/09/2026 (F7, prévention INC-16) par lecture du
code réel (`process.env.*` dans `web/`, hors tests), pas au jugé.

## Contrôle en production

`GET /api/sante/configuration` (public, `no-store`) :
- tout est posé → `200 {"ok": true}` ;
- seule une **dégradante** manque → `200 {"ok": true, "degrade": N}` (invités bloqués,
  propriétaire OK) ;
- une **requise** manque → `503 {"ok": false, "cause": "configuration", "manquantes": N,
  "message": "configuration incomplète : N variables manquantes"}` (+ `degrade` s'il y a lieu).

⚠️ La réponse ne nomme JAMAIS une variable (un attaquant y lirait la carte de ce qu'il faut
forcer). Les **noms** manquants sont dans les journaux Vercel de la fonction, ligne
`[sante/configuration] manquantes — …`. Seule route servie quand l'authentification n'est
pas configurée (sinon, dans le cas exact d'INC-16, elle ne répondrait jamais). Même règle
pour le 503 du middleware : message générique, noms au journal (`[middleware] …`).
Listes figées : `web/lib/configurationRequise.ts` — y ajouter une variable = décider de son
niveau, et mettre ces tableaux à jour dans la même PR.

## Requises (absence = tout le monde bloqué) — `manquantes`, 503

| Variable | Si absente |
|---|---|
| `DATABASE_URL` | Toute page qui lit la base lève (`lib/db`, connexion paresseuse) ; `/api/sante` → 503. |
| `AUTH_SECRET` | Le middleware répond 503 `auth_unconfigured` à tout (INC-16). |
| `AUTHORIZED_EMAIL` | Idem (`lib/authConfigured.ts`). |
| `GOOGLE_CLIENT_ID` | La connexion Google échoue ; plus personne n'entre. |
| `GOOGLE_CLIENT_SECRET` | Idem ; le rafraîchissement des jetons Google (`lib/jetonsGoogle.ts`) échoue aussi. |

## Dégradantes (absence = invités bloqués, propriétaire OK) — `degrade`, 200

| Variable | Si absente |
|---|---|
| `HUB_TOKEN` | Aucun invité n'entre (échec fermé, `lib/accesHub.ts`) — le propriétaire passe ; `/api/hub/summary` → 503. |

## Optionnelles — une fonctionnalité s'éteint ou un défaut s'applique, non comptées

| Variable | Si absente |
|---|---|
| `ANTHROPIC_API_KEY` | Import et analyse de recettes lèvent une erreur nommée ; l'assistant affiche « pas configuré ». Le reste de l'app marche. |
| `MCP_TOKEN` | `/api/mcp` → 503 « MCP_TOKEN non configuré » ; le connecteur OAuth est éteint. |
| `MCP_OAUTH_SIGNING_KEY` | Clé de signature OAuth dérivée de `MCP_TOKEN` (≥ 32 caractères pour être prise). |
| `GROQ_API_KEY` | Transcription audio des vidéos « désactivée » (dit à l'écran, `lib/transcription.ts`). |
| `AUTH_COOKIE_DOMAIN` | Pas de session partagée entre les apps du hub ; connexion propre à BatchChef. |
| `NEXT_PUBLIC_HUB_URL` | Défaut `https://hubperso.com`. ⚠️ Fonctionnelle : la changer coupe l'accès des invités. |
| `BATCHCHEF_PUBLIC_URL` | Défaut `https://batchchef.hubperso.com` (résumé hub, émetteur OAuth). |
| `BATCHCHEF_LLM_MODEL`, `BATCHCHEF_LLM_MODEL_VISION`, `BATCHCHEF_MODELE_ASSISTANT`, `BATCHCHEF_MODELE_TRANSCRIPTION` | Modèle par défaut du code. |
| `BATCHCHEF_LLM_PRICE_IN`, `BATCHCHEF_LLM_PRICE_OUT` | Tarif par défaut (1,0 / 5,0 $ par million de jetons) pour l'estimation de coût publiée au hub. |

## Build seulement (posées par Vercel, pas par Marc)

`VERCEL`, `VERCEL_ENV` : `scripts/vercel-build.mjs` ne migre la base qu'en production, et
échoue si `VERCEL_ENV` manque sur Vercel (voir `05-deploiement.md`).
