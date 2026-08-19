# ADR-0001 — Serveur MCP distant, protocole écrit à la main, outils en écriture

- **Date** : 2026-08-19
- **Statut** : accepté (décisions de Marc, 19/08/2026)
- **Portée** : `web/app/api/mcp/route.ts`, `web/lib/mcp/`

## Contexte

Marc a demandé « un MCP pour cette app ». Deux questions de cadrage lui ont été posées, et
ses deux réponses fixent tout le reste :

1. **Où tourne le serveur ?** → *distant, sur Vercel* (`POST /api/mcp`), pas un binaire local
   à lancer sur son PC. Cohérent avec la règle « aucune commande à taper » : un serveur local
   demanderait de l'installer, de le lancer, et de le relancer à chaque redémarrage.
2. **Que peut-il faire ?** → *lecture ET écriture dès maintenant*, pas de première étape en
   lecture seule.

BatchChef a déjà un assistant intégré (`/assistant`, livré le même jour) qui fouille la base
par outils. Le MCP ne le remplace pas : il ouvre la même base **depuis l'extérieur** — Claude
Code, l'app Claude, n'importe quel client MCP — là où l'assistant intégré vit dans l'app.

## Décision

**1. Le JSON-RPC est écrit à la main ; le SDK officiel reste en devDependency.**

`@modelcontextprotocol/sdk` pèse 8,7 Mo et tire 17 dépendances runtime — express, hono, cors,
jose — pour un transport **à sessions** (`StreamableHTTPServerTransport` garde un état entre
les requêtes). Une fonction serverless Vercel n'a pas de session à garder : chaque appel est
un processus neuf. Payer un serveur HTTP complet à l'intérieur d'un serveur HTTP pour un
protocole qui tient en un `switch` sur cinq méthodes serait du poids sans contrepartie.

Le SDK n'est pas jeté pour autant : il est **la vérité** contre laquelle nos constantes sont
vérifiées (`tests/mcp.test.ts`). Si `LATEST_PROTOCOL_VERSION` ou la liste des versions
supportées bougent chez lui et pas chez nous, le test tombe. Sans ce verrou, une constante
recopiée dérive en silence — et une dérive de protocole se manifeste par un client qui ne
parle plus, pas par une erreur.

**2. Les écritures passent par les fonctions de travail de l'app, jamais par du SQL réécrit.**

`lib/actions.ts` a été scindé en deux couches : la fonction de **travail**
(`creerBatchInterne`, `ajouterDuCatalogueInterne`, `cocherArticleInterne`) et la **Server
Action** qui la garde par `requireSession`. Le MCP appelle la première ; l'app appelle la
seconde. Un batch créé par Claude passe donc exactement par les mêmes règles qu'un batch créé
au doigt : sel et poivre écartés de la liste, prix estimés, dédup du catalogue.

**3. L'autorisation est un jeton porteur, et son absence est un 503, pas un 401.**

`MCP_TOKEN` en variable d'environnement, comparé en temps constant (SHA-256 +
`timingSafeEqual`), lu depuis `Authorization: Bearer` ou `x-mcp-token`. Trois cas distincts,
comme pour le hub :

| Situation | Réponse | Ce que ça veut dire |
|---|---|---|
| `MCP_TOKEN` absent de l'environnement | **503** | intégration éteinte, pas une panne |
| jeton absent ou faux | **401** | appelant non autorisé |
| méthode ≠ POST | **405** | |

Confondre 503 et 401 rendrait indiscernables « je n'ai pas configuré ça » et « quelqu'un
frappe à la porte » — deux situations qui appellent deux gestes opposés.

**4. La route est hors du middleware de session, par ÉGALITÉ stricte.**

`isPublicPath` exempte `/api/mcp` — et lui seul, jamais son préfixe. C'est le piège n°1 du
squelette de l'écosystème : sous la garde de session, un appelant machine reçoit une
**redirection HTML vers `/login`** au lieu du JSON-RPC. Le serveur paraît muet, aucune erreur
nulle part. Verrouillé par `tests/auth.test.ts`, discrimination prouvée par mutation
(remplacer l'égalité par `startsWith` fait tomber le test).

## Ce qui n'est PAS exposé, et pourquoi

**L'import d'une recette depuis une URL.** Il coûte deux appels LLM, mais surtout il
court-circuiterait l'écran de validation. La règle du projet est « le LLM propose, le code
valide, Marc confirme » : un import sans relecture mettrait en base des quantités que
personne n'a vues. Les sept outils exposés lisent, ou écrivent des choses que Marc peut
défaire d'un geste (un batch se supprime, un article se décoche).

## Trade-offs assumés

- **Un `switch` écrit à la main peut diverger du protocole.** C'est le prix du poids en moins,
  et c'est précisément ce que le tripwire surveille. Il ne couvre que les versions et
  l'enveloppe JSON-RPC — pas une future méthode obligatoire, qu'il faudra lire dans la spec.
- **Séparer déclaration et exécution** (`declarations.ts` / `outils.ts`) rend les outils
  testables sans démarrer next-auth, mais rien n'oblige plus le `switch` à connaître ce qu'on
  annonce. Verrouillé **dans les deux sens** par `tests/mcp.test.ts`, qui relit le source
  d'`outils.ts` — un outil annoncé sans branche répondrait « Outil inconnu » à un Claude qui
  l'a choisi sur la foi de sa description.
- **Le jeton porteur n'est pas OAuth 2.1.** Il suffit à tout client qui laisse poser un
  en-tête. L'interface de connecteurs de claude.ai peut exiger un flux OAuth complet : non
  vérifié d'ici (pas de réseau vers claude.ai), à constater au premier branchement réel.
  Noté `MCP-03` au backlog plutôt qu'annoncé comme acquis.

## Alternatives rejetées

- **SDK officiel en production.** Rejeté sur le poids (8,7 Mo, 17 dépendances runtime) pour
  un transport à sessions inutile en serverless. Gardé comme devDependency-vérité.
- **Serveur MCP local (stdio).** Rejeté : il demanderait à Marc de l'installer et de le
  lancer. « Aucune commande à taper » est une règle du projet, pas une préférence.
- **Lecture seule d'abord.** Proposé, refusé par Marc. Un MCP qui ne peut que lire obligerait
  à revenir dans l'app pour tout geste — ce qui vide l'intérêt d'y accéder depuis Claude.
- **Réécrire les écritures en SQL dans le MCP.** Rejeté : deux implémentations d'une même
  règle, c'est une règle et demie. Les garde-fous doivent valoir pour Claude comme pour Marc.

## Vérification

Onze sondes contre un serveur **réellement démarré** (`next start` local), pas seulement
compilé : négociation de version, `tools/list` (7 outils), notification sans réponse (204),
401 sur jeton faux **et** absent, 405 sur GET, lot de 3 rendant 2 réponses, méthode inconnue
(−32601), panne d'outil rendue en `isError` avec le transport intact, outil inconnu, et 503
quand `MCP_TOKEN` manque. Un build qui compile ne prouve que la compilation.
