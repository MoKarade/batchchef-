# 13. LIA dans BatchChef

LIA, l'assistant de Marc, vit chez **MemoryAI** (cerveau, mémoire, outils). Chaque app ne fait que
l'afficher et lui relayer les questions **par le hub**, seul détenteur des jetons (MemoryAI ne détient aucun jeton d'app). Le corps (traits en canvas, vie propre, chat au clic,
menu au clic droit) vient du paquet `@mokarade/lia-ui`, épinglé **par tag** (`github:MoKarade/lia-ui#v0.28.0`),
jamais par branche, jamais publié sur npm. Mise à jour = changer le tag dans `package.json` ET le lock, comme `hub-contract`.
**Une seule LIA, mêmes réglages que le hub** : `demarrerLia` ne reçoit que `ask` ; ni `quandMouvementReduit`, `humeurVisible`, `parolePropre` ni `onSpontane` (défauts du paquet : animations complètes, pastille d'humeur du paquet, parole propre vraie par construction : jamais rien sur Marc ni sur l'app). Verrou : `web/tests/liaReglages.test.ts`.

## Chemin d'une question

```
navigateur ──POST /api/lia/ask──▶ app ──POST /api/lia/ask (x-hub-token)──▶ hub ──▶ MemoryAI
 (cookie de session)            (requireSession)   (HUB_TOKEN de l'app)
```

| Pièce | Rôle |
|---|---|
| `lib/lia/contrat.ts` | Schémas Zod de la demande et de la réponse (pur) |
| `lib/lia/demander.ts` | Appel serveur vers le hub : https, jeton en en-tête, délai 35 s, échec fermé |
| `web/app/api/lia/ask/route.ts` | Route derrière le middleware ET `requireSession()` ; corps ≤ 8 Ko ; 401 / 400 / 413 / 503 |
| `lib/lia/session.ts` | La garde de session de LIA (BatchChef n'a pas de `lib/session.ts`) : `NonAutorise` + l'adresse de la session |
| `lib/lia/client.ts` | Le `ask` du navigateur : parle à la route de l'app, jamais au hub |
| `lib/lia/demarrage.ts` + `instrumentation-client.ts` | LIA montée hors rendu par `demarrerLia` (`@mokarade/lia-ui/boot`), avant l'hydratation : présente même pendant un chargement ou si une page plante. Seule route sans LIA : `/login` |

## Règles

- **`HUB_TOKEN` identifie l'app chez le hub** (comme pour `/api/acces`) : aucun identifiant d'app dans le corps. Il ne sort jamais du serveur.
- **`proprietaire`** : l'app envoie au hub `proprietaire: true` seulement si l'email de session égale `AUTHORIZED_EMAIL` (`estProprietaire`). Une app a des invités, MemoryAI jamais : sans ce champ MemoryAI répond 403, donc un invité n'interroge pas la mémoire de Marc.
- **Échec fermé** : sans `HUB_TOKEN`, hub ou MemoryAI en panne, trop lents ou non conformes → 503, et LIA dit « indisponible ». Jamais de réponse inventée.
- **Texte reçu du hub = donnée** : validé par Zod, affiché par `textContent` (jamais `innerHTML`).
- **v1 : texte, puces et humeur seulement.** Les blocs composés (`blocks`) sont strippés ; l'app n'a pas de rendu pour eux.
- **Pas d'actions** dans le menu du clic droit en v1 : LIA propose, le hub exécute (catalogue : `hub-contract#78`).
- **Une seule LIA par page, une seule voie** : `demarrerLia` depuis `instrumentation-client.ts`. Ne jamais monter `<Lia>` (`@mokarade/lia-ui/react`) en plus : deux LIA (verrou `tests/liaReglages.test.ts`).
- ⚠️ Après une déconnexion (`signOut` → `/login` sans rechargement complet), LIA reste à l'écran jusqu'au prochain chargement ; sa question reçoit 401 et elle dit « indisponible ».
- L'URL est `NEXT_PUBLIC_HUB_URL` (déjà utilisée par `accesHub.ts`, défaut `https://hubperso.com`) ; `http:` est refusé.
- ⚠️ Un fork avec une **CSP** doit autoriser les styles que le paquet injecte (`style-src`), sinon LIA s'affiche sans habillage.

- **BatchChef** : `/api/lia/ask` reste derrière le middleware (jamais confondue avec `/api/mcp`, hors middleware par égalité stricte) ; les chemins de ce document sont sous `web/`.
