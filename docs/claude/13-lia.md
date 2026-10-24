# 13. LIA dans BatchChef

LIA, l'assistant de Marc, vit chez **MemoryAI** (cerveau, mémoire, outils). Chaque app ne fait que
l'afficher et lui relayer les questions **par le hub**, seul détenteur des jetons (MemoryAI ne détient aucun jeton d'app). Le corps (traits en canvas, vie propre, chat au clic,
menu au clic droit) vient du paquet `@mokarade/lia-ui`, épinglé **par tag** (`github:MoKarade/lia-ui#v0.37.2`),
jamais par branche, jamais publié sur npm. Mise à jour = changer le tag dans `package.json` ET le lock, comme `hub-contract`.
**Une seule LIA, mêmes réglages que le hub** : `demarrerLia` ne reçoit que `ask`, `pause` (la pause générale du hub) et `etat` (l'état partagé, voir plus bas) ; ni `quandMouvementReduit`, `humeurVisible`, `parolePropre` ni `onSpontane` (défauts du paquet : animations complètes, pastille d'humeur du paquet, parole propre vraie par construction : jamais rien sur Marc ni sur l'app). Verrou : `web/tests/liaReglages.test.ts`.

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
| `lib/lia/client.ts` | Le `ask` du navigateur et la lecture de la pause : parle aux routes de l'app, jamais au hub |
| `lib/lia/pause.ts` | La pause telle que la page la sait (pur) : dernière lecture en mémoire, relue toutes les 30 s, crue 90 s, jamais lue ou illisible = en pause |
| `lib/lia/hubCookie.ts` | `fetchHubAvecCookie` : appelle le hub avec le cookie et suit la redirection apex → www sans perdre le cookie (voir la règle plus bas) |
| `lib/lia/etat.ts` | L'état partagé jugé (pur) : corps d'écriture borné à 16 Ko et validé par `validerEtat` (400/413), réponse du hub rendue seulement si c'est un état valide (200, 409 d'écriture), 204 sans état, 401/403/429 tels quels, le reste en 503 |
| `lib/lia/etatHub.ts` + `web/app/api/lia/etat/route.ts` | `GET\|PUT /api/lia/etat` (derrière le middleware ET `requireSession()`) relaie `/api/lia/etat` du hub avec le cookie de session de l'utilisateur (https obligatoire, délai 10 s) ; jamais de `HUB_TOKEN` ici, le hub juge la session du propriétaire |
| `lib/lia/pauseHub.ts` + `web/app/api/lia/pause/route.ts` | `GET /api/lia/pause` (derrière le middleware ET `requireSession()`, lecture seule) relaie `GET /api/lia/pause` du hub avec le cookie de session de l'utilisateur (partagé entre sous-domaines, https obligatoire) ; 200 `{ pause }` ou 503 |
| `lib/lia/demarrage.ts` + `instrumentation-client.ts` | LIA montée hors rendu par `demarrerLia` (`@mokarade/lia-ui/boot`), avant l'hydratation : présente même pendant un chargement ou si une page plante, et sur TOUTES les pages. Sur `/login` (pas de session) : mode invité, `ask` refuse avant tout réseau (`creerAsk`) |

## Règles

- **`HUB_TOKEN` identifie l'app chez le hub** (comme pour `/api/acces`) : aucun identifiant d'app dans le corps. Il ne sort jamais du serveur.
- **`proprietaire`** : l'app envoie au hub `proprietaire: true` seulement si l'email de session égale `AUTHORIZED_EMAIL` (`estProprietaire`). Une app a des invités, MemoryAI jamais : sans ce champ MemoryAI répond 403, donc un invité n'interroge pas la mémoire de Marc.
- **Échec fermé** : sans `HUB_TOKEN`, hub ou MemoryAI en panne, trop lents ou non conformes → 503, et LIA dit « indisponible ». Jamais de réponse inventée.
- **Texte reçu du hub = donnée** : validé par Zod, affiché par `textContent` (jamais `innerHTML`).
- **v1 : texte, puces et humeur seulement.** Les blocs composés (`blocks`) sont strippés ; l'app n'a pas de rendu pour eux.
- **Pas d'actions** dans le menu du clic droit en v1 : LIA propose, le hub exécute (catalogue : `hub-contract#78`).
- **Une seule LIA par page, une seule voie** : `demarrerLia` depuis `instrumentation-client.ts`. Ne jamais monter `<Lia>` (`@mokarade/lia-ui/react`) en plus : deux LIA (verrou `tests/liaReglages.test.ts`).
- **Pause générale (24/10/2026, Hubperso#313)** : le hub tient l'interrupteur (en base) et son `POST /api/lia/ask` rend 423 sans appeler MemoryAI tant qu'il est posé. Ici : ce 423 arrive au navigateur en 423 `{ error: "paused" }` (`LiaEnPause`, distinct du 503 de panne) ; l'option `pause` de lia-ui, nourrie par `GET /api/lia/pause`, laisse LIA se taire à l'écran sans attendre un refus. Le hub ne rend la pause qu'à un propriétaire (401 sans session, 403 pour un invité) : pour un invité elle reste illisible, donc en pause. Sur `/login` elle n'est jamais en pause (rien n'y part au réseau). Pas de `basculerPause` : la pause s'écrit au hub.
- **Une seule LIA, un seul état (24/10/2026, tâche #304)** : humeur, envies, journal et mémoire lente sont ceux de MemoryAI, lus et écrits par le hub (`/api/lia/etat`, propriétaire seul : 403 pour un invité). La page parle à `/api/lia/etat` de l'app (`etatHttp`, même origine), qui relaie au hub avec la session ; si la route échoue (503) ou sur `/login` (aucun appel, `creerEtat`), LIA garde son état local et vit quand même. Le contrat d'état est `commun/assistant/CONTRAT-etat-lia.md` ; ne jamais écrire dans cet état autre chose que ce que `validerEtat` laisse passer.
- **Le cookie ne survit pas à la redirection apex → www (24/10/2026)** : le hub sert `www.hubperso.com` et `hubperso.com` répond 308 vers lui ; `fetch` (undici) RETIRE l'en-tête `cookie` quand une redirection change d'origine (pas `x-hub-token`). Les relais de l'état et de la pause recevaient donc 401 du hub. `lib/lia/hubCookie.ts` suit la redirection soi-même, une fois, en 307/308, vers le même hôte à `www.` près en https seulement. Tout relais NOUVEAU qui transmet le cookie au hub passe par `fetchHubAvecCookie`, jamais par `fetch` direct. Les refus du hub sont journalisés par leur statut (`[lia/etat]`, `[lia/pause]`).
- **Mode invité (24/10/2026, Marc : « LIA présente tout le temps, y compris sur /login »)** : sur `/login` LIA bouge, a une humeur et parle avec ses propres phrases, mais `ask` rejette AVANT tout réseau (elle dit « indisponible ») ; la route `/api/lia/ask` reste derrière la session. Le mode se relit à chaque question d'après `window.location.pathname` : une déconnexion vers `/login` sans rechargement complet referme `ask`, une connexion (rechargement complet) le rouvre. Aucun état partagé (BatchChef ne transporte pas `etat`). Routes sans LIA : aucune page ; seules les routes qui ne rendent rien (`/api/*`, `/hub/summary`) n'en ont pas.
- Même mouvement que app-template#141 (LIA en mode invité), sans composant : BatchChef démarre `demarrerLia` depuis `instrumentation-client.ts`, pas depuis un module client rendu par le layout.
- L'URL est `NEXT_PUBLIC_HUB_URL` (déjà utilisée par `accesHub.ts`, défaut `https://hubperso.com`) ; `http:` est refusé.
- ⚠️ Un fork avec une **CSP** doit autoriser les styles que le paquet injecte (`style-src`), sinon LIA s'affiche sans habillage.

- **BatchChef** : `/api/lia/ask` reste derrière le middleware (jamais confondue avec `/api/mcp`, hors middleware par égalité stricte) ; les chemins de ce document sont sous `web/`.
