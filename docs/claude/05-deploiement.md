# Déploiement et préversion base prod (ancien §6 + sous-section)

> Repris mot pour mot de l'ancien `CLAUDE.md` (lignes 444 à 509). Index : [`docs/INDEX.md`](../INDEX.md).

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
famille). Le seul déclencheur fiable est un NOUVEAU push sur `master` — et **n'importe
lequel suffit, même de la doc seule** : `build-necessaire.sh` compare au dernier commit
DÉPLOYÉ (`VERCEL_GIT_PREVIOUS_SHA`), pas au précédent, donc le diff couvre tout ce qui manque
en production. Mesuré le 25/09 : un commit de doc (#125) a construit `READY` et rattrapé
quatre merges restés sans déploiement. *(Cette ligne disait jusque-là qu'un commit doc-only
« serait ignoré » : c'est vrai sans retard, faux après un trou — le cas même où on s'en sert.)*

Corollaire : un merge qui ne change QUE de la doc n'a pas de déploiement à vérifier. Le dire
plutôt que de laisser croire qu'on a vérifié.

### ⚠️ Une PRÉVERSION écrit dans la base de PRODUCTION

✅ **GARDE EN PLACE (25/09/2026).** `vercel-build` lance `node scripts/vercel-build.mjs` : `db:migrate` et
`db:reparer-ingredients` ne tournent QUE si `VERCEL_ENV` vaut exactement `production` ; en préversion (ou
variable absente, vide, inconnue : échec fermé) le script les saute, journalise « préversion : migrations et
réparation sautées » et lance seulement `next build`. Logique pure et testée : `web/tests/vercelBuild.test.ts`.
**Échec volontaire** : sur Vercel (`VERCEL=1`), si `VERCEL_ENV` est absente ou vide (réglage « Automatically expose System Environment Variables » désactivé), le build échoue (code 1, message clair) : sans cela la production ne migrerait plus, sans erreur. Hors Vercel (poste local, `VERCEL` absent) : build seul, inchangé.
**Risque restant** : le RUNTIME d'une préversion garde `DATABASE_URL`, donc une préversion qui s'exécute lit
et écrit dans la base de production tant que Marc n'a pas configuré une branche Neon dédiée aux
préversions. Une migration reste donc appliquée seulement au build de production (au merge) : la
description ci-dessous est l'ancien comportement, gardée pour comprendre le risque si la garde était retirée.

Avant la garde : il n'y a qu'une base Neon, et `vercel-build` faisait `db:migrate` (puis `db:reparer-ingredients`)
**avant** `next build`. Or Vercel construit aussi chaque préversion. Donc **une migration ou un
script de données s'appliquait à la production dès le premier build de la PR — avant tout merge,
avant toute revue.**

⚠️ **PLUS VRAI DES BRANCHES `claude/*` depuis le 14/09.** `web/vercel.json` porte
`git.deploymentEnabled: { "claude/*": false }` : Vercel ne construit AUCUNE préversion pour
ces branches, donc leurs migrations n'atteignent la production qu'**au merge**. Vérifié sur
la PR #86 — zéro déploiement créé pour son push. Le paragraphe ci-dessus reste vrai pour
toute autre branche (`feature/*`, un push direct), et la vigilance reste la même : ce qui a
changé, c'est QUAND ça mord, pas SI.

Constaté le 19/08 : la réparation des noms (`ING-03`) avait déjà traité 16 870 lignes de
production quand j'ai lu les logs de la PRÉVERSION. Sans conséquence ici — la passe est
idempotente, non destructive, et c'était le correctif voulu — mais le mécanisme, lui, ne
distingue pas.

Ce n'est pas nouveau (`db:migrate` y était depuis toujours) ; c'est simplement rarement
visible. Deux règles qui en découlent :

1. **« On essaiera d'abord sur une branche » reste FAUX ici.** La garde empêche la migration au build d'une préversion, mais une migration destructive
   (suppression de colonne, réécriture de données) touche la production au MERGE, et le runtime d'une préversion lit déjà la base de production.
   Faire valider par Marc AVANT de pousser, pas seulement avant de merger.
2. Un script de données dans `vercel-build` doit être **idempotent**, **non destructif**, et
   **tracer ce qu'il a fait** — sinon on ne peut même pas savoir, après coup, ce qu'une
   préversion a modifié.

