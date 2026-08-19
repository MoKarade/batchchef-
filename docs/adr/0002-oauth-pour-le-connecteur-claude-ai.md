# ADR-0002 — OAuth 2.1 mono-utilisateur pour brancher le MCP depuis claude.ai

- **Date** : 2026-08-19
- **Statut** : accepté (demande de Marc, le jour même de l'ADR-0001)
- **Portée** : `web/lib/mcp/oauth*.ts`, `web/app/api/mcp/oauth/*`, `web/app/.well-known/*`

## Contexte

L'ADR-0001 a livré le serveur MCP, gardé par un jeton porteur en en-tête. Marc a essayé de
le brancher et a buté sur : « me manque l'adresse, regarde ce que DriveAI a fait, ça marche. »

L'adresse était bonne. Le problème est ailleurs, et il ne se voit pas depuis le dépôt :

**L'interface « Ajouter un connecteur personnalisé » de claude.ai ne prend qu'une URL.** Il
n'y a aucun champ pour un en-tête. Un serveur gardé par un `Authorization` statique y reçoit
donc une requête SANS jeton, répond 401 — et comme ce 401 ne porte rien à découvrir, le
connecteur échoue sans rien expliquer. L'app, elle, marche parfaitement par ailleurs.

Vérifié plutôt que supposé, en lisant les connecteurs qui MARCHENT chez Marc :

- la configuration MCP réelle de la session montre `financeAImcp` branché sur une **URL nue**,
  sans en-tête d'authentification applicatif ;
- le serveur MCP de FinanceAI (`mcp/http.ts`, `mcp/auth/oauthProvider.ts`) implémente un
  **OAuth 2.1 mono-utilisateur** complet, et son en-tête le dit noir sur blanc : *« pourquoi
  pas un simple Bearer statique : l'UI des connecteurs custom de claude.ai n'offre QUE OAuth
  (vérifié 2026-07-13) »*. Le même mur, quarante jours plus tôt, dans le même écosystème.

## Décision

Implémenter le même OAuth 2.1 mono-utilisateur, adapté à Next.js sur Vercel. Le jeton porteur
direct **reste accepté** : Claude Code sait poser un en-tête, et c'est le chemin le plus court.
Deux portes, une seule maison.

**1. Sans état, parce que le serverless l'impose.** Jetons et codes sont des charges JSON
signées HMAC-SHA256 : n'importe quelle instance les vérifie sans rien stocker. L'enregistrement
dynamique de client (RFC 7591) se passe de base lui aussi — `client_secret = HMAC(client_id)`,
re-dérivable partout.

**2. Une exception à l'apatridie : l'usage unique.** OAuth 2.1 exige qu'un code serve une
seule fois, et que le jeton de rafraîchissement tourne. FinanceAI tient cette liste **en
mémoire**, ce qui suffit sur une instance Cloud Run chaude. Ici ça ne protégerait rien :
Vercel démarre des instances à froid et en parallèle, donc un code rejoué tomberait presque
toujours sur une mémoire vierge. La liste vit donc en **base** (`mcp_oauth_consumed`), seule
mémoire partagée par toutes les instances. L'atomicité vient du `ON CONFLICT DO NOTHING` :
un « lire puis écrire » laisserait passer deux requêtes simultanées — exactement le rejeu
que ce garde doit empêcher, et c'est en concurrence qu'on l'essaierait.

**3. Un seul secret à poser.** `MCP_TOKEN` sert deux fois : jeton direct pour Claude Code, et
clé d'accès que Marc tape sur la page de consentement. La clé de signature en est **dérivée**
par HMAC — deux usages distincts d'une même racine, jamais la même valeur en clair.
`MCP_OAUTH_SIGNING_KEY` reste surchargeable : c'est le **kill-switch**. La changer révoque
toutes les connexions sans toucher à la clé que Marc tape ; sans elle, tout révoquer
obligerait à changer `MCP_TOKEN`, donc à reconfigurer Claude Code aussi. Deux gestes de
gravité différente méritent deux leviers.

**4. Un plafond de tentatives, en base.** `/api/mcp/oauth/authorize` est la **seule porte
devinable** du serveur : partout ailleurs il faut déjà une signature HMAC valide. Le minimum
de longueur imposé à `MCP_TOKEN` (16) borne la longueur, pas l'**entropie** — une clé de
seize caractères choisie à la main se devine en quelques millions d'essais. Le plafond vit en
base pour la même raison que l'usage unique : un compteur de process compterait jusqu'à trois,
pour toujours. Base injoignable ⇒ on **ferme**, avec un message qui le dit : un plafond qui
s'ouvre quand son compteur tombe en panne ne protège rien.

## Les contrôles qui, mal faits, livrent l'accès

Tous repris de la revue de sécurité de FinanceAI, tous verrouillés par un test dont la
discrimination est prouvée par mutation :

| Contrôle | Ce qu'un raccourci coûterait |
|---|---|
| Allowlist de redirection par **origine exacte** | `https://claude.ai@evil.com` a pour host `evil.com`, et `https://claude.ai.evil.com` commence bien par `https://claude.ai`. Un `startsWith` livrerait le code d'autorisation. |
| **PKCE S256 obligatoire** | Un code intercepté suffirait à obtenir les jetons. |
| **Type dans la charge signée** (`acces` / `code` / `rafraichissement`) | Un code d'autorisation transite en clair dans une URL de redirection ; sans le type, il ouvrirait `/api/mcp`. |
| **Usage unique** du code et rotation du refresh | Rejeu. |
| Allowlist re-vérifiée **à l'autorisation**, pas seulement à l'enregistrement | Le garde ne doit pas dépendre de la discipline de l'appelant. |
| Comparaison de la clé en **temps constant** | Fuite par la durée. |

## Trade-offs assumés

- **Deux tables de plus** (`mcp_oauth_consumed`, `mcp_oauth_attempts`). Assumé : ce sont les
  deux seules choses que la cryptographie ne peut pas porter, et les tenir en mémoire aurait
  produit des gardes décoratifs.
- **Une page de consentement à palette autonome.** Servie en HTML brut hors du React, elle ne
  charge pas `globals.css`. Le garde du socle visuel l'a attrapée — et plutôt que de l'exempter,
  il la vérifie désormais **contre elle-même** (chaque jeton cité défini, en clair ET en
  sombre). Exempter aurait rendu la page invérifiable ; c'est le même arbitrage que « un garde
  qui s'exclut d'un dossier entier s'en exclut pour toujours ».
- **La dérivation de la clé de signature lie les deux secrets par défaut.** Changer `MCP_TOKEN`
  révoque les connexions OAuth. C'est acceptable — et le kill-switch existe pour l'inverse.

## Alternatives rejetées

- **Le jeton dans l'URL** (`/api/mcp/s/<jeton>`). Ça marcherait avec le connecteur sans une
  ligne d'OAuth. Rejeté : un secret dans une URL est journalisé par la plateforme, reste dans
  l'historique et dans l'écran de réglages, et il n'a aucun moyen d'expirer.
- **Ouvrir `/api/mcp` sans authentification.** Rejeté : la base contient les recettes et les
  listes de Marc.
- **Attendre que claude.ai accepte les en-têtes.** Rejeté : c'est un pari sur le calendrier de
  quelqu'un d'autre, et FinanceAI attend depuis le 13/07.

## Vérification

Onze sondes contre un serveur **réellement démarré**, en plus des 326 tests : découverte
RFC 9728 (racine **et** variante path-aware), découverte RFC 8414, 401 portant le
`WWW-Authenticate` qui rend la découverte possible, enregistrement dynamique, refus d'une
redirection déguisée, page de consentement rendue, refus sans PKCE, fermeture propre quand la
base ne répond pas, **jeton OAuth accepté par `/api/mcp`** (7 outils rendus), jeton direct
toujours accepté, jeton signé par une autre clé refusé.

Ce qui n'a **pas** pu être joué en local : l'échange code ↔ jetons, qui touche la base
(aucun Postgres dans cet environnement). Il est couvert par 31 tests unitaires — parcours
complet, usage unique, PKCE, rotation, expiration — avec le `consommer` injecté.
