# Leçons — BatchChef

> Ce qui a été appris **en le vivant**, pas en le supposant. Une leçon dont la règle change
> la façon de coder remonte dans `CLAUDE.md` ; le récit reste ici.
>
> Convention de l'écosystème (DriveAI, JobAI). Créé le 2026-08-17 : les leçons de ce dépôt
> vivaient jusque-là dans `CLAUDE.md` ou nulle part.

---

## 2026-08-19 — `form-action` couvre la REDIRECTION, pas seulement la première cible

En vérifiant le connecteur en production, j'ai lu les en-têtes de la réponse plutôt que de
me contenter du code de statut. La CSP disait :

```
form-action 'self' https://accounts.google.com
```

Or la page de consentement OAuth poste vers elle-même (`'self'`, autorisé) **puis redirige**
vers `https://claude.ai/...` avec le code d'autorisation. Et `form-action` s'applique à la
CHAÎNE DE REDIRECTION qui suit une soumission, pas seulement à sa première cible.

Rien ne cassait : la CSP est en `Report-Only`. Mais le jour où on la passe en enforcé — ce
qui est une intention écrite dans cet écosystème — le branchement du connecteur serait coupé
**à la dernière étape**, par le navigateur, sans erreur serveur et sans rien dans les
journaux. Ça ressemblerait à « le connecteur ne marche pas », et on chercherait dans l'OAuth.

**Règle** : une directive CSP se relit à chaque fois qu'on ajoute un flux qui SORT du site —
formulaire, redirection, `fetch`. Et un `Report-Only` n'est pas une excuse pour remettre à
plus tard : c'est exactement la fenêtre où le trou se ferme gratuitement, parce qu'après le
passage en enforcé il se paie en diagnostic. Verrouillé par `tests/deploiement.test.ts`, qui
vérifie en plus que les origines de la CSP et celles de l'allowlist du code OAuth **ne
divergent pas** — deux listes qui disent la même chose finissent toujours par se contredire.

**Corollaire, trouvé en écrivant ce test** : mon premier jet cherchait la ligne contenant
`form-action`, et attrapait le COMMENTAIRE que je venais d'écrire pour expliquer la
directive. Le test annonçait que `form-action` n'autorisait pas Google, alors qu'il
l'autorisait. Même famille que « Tailwind génère du CSS depuis la prose qui parle du CSS » :
un scan ancré sur un MOT attrape ce qui parle de la chose autant que la chose. Ancrer sur la
FORME de la valeur (ici guillemet + directive + espace), jamais sur le terme.

## 2026-08-19 — La préversion d'une PR écrit dans la base de production

J'ai livré la réparation des noms d'ingrédients et j'allais annoncer à Marc qu'elle
s'appliquerait « au prochain déploiement de production ». Par acquit de conscience, j'ai lu
les logs de build de la PRÉVERSION de la PR. Elle disait :

    [noms] catalogue : 2371 nom(s) distinct(s) réparé(s), 16822 ligne(s) mise(s) à jour.
    [noms] Terminé : 16870 ligne(s) réparée(s).

C'était déjà fait. Sur la vraie base, depuis une branche non mergée.

L'explication est simple et elle était sous mes yeux : il n'y a qu'UNE base Neon, et
`vercel-build` enchaîne `db:migrate` puis mon script avant `next build`. Vercel construit
aussi les préversions. Donc chaque push sur une branche applique ses migrations à la
production. Ce n'est pas moi qui l'ai introduit — `db:migrate` y était depuis toujours — mais
personne ne l'avait jamais constaté, parce qu'une migration de schéma additive ne se voit pas.
Il a fallu un script qui COMPTE ce qu'il touche pour que le mécanisme devienne lisible.

Sans conséquence cette fois : la passe est idempotente, non destructive, et c'était le
correctif voulu. Mais le mécanisme ne fait pas la différence entre « le correctif voulu » et
« une migration qu'on voulait d'abord essayer ».

**Règle** : sur un projet à base unique, « on essaiera d'abord sur une branche » est FAUX. Une
migration destructive touche la production au premier push, avant merge et avant revue. Ce
qui se fait valider se fait valider avant le PUSH. Et tout script de données placé dans le
chemin de build doit être idempotent, non destructif, et **tracer ce qu'il a modifié** — sinon
on ne peut même pas savoir après coup ce qu'une préversion a fait.

**Corollaire de méthode** : c'est le fait d'avoir mis un compteur dans les logs qui a rendu ce
mécanisme visible. Un script silencieux aurait « marché » et je serais parti avec une
description fausse de ce qui s'était passé — pas un bug, juste une compréhension erronée du
système, qui aurait servi de base à la décision suivante.

---

## 2026-08-19 — J'ai mesuré ma propre complétude avec mon propre détecteur

Le matin, j'ai réparé les noms d'ingrédients et j'ai annoncé le résultat avec assurance :
**« 2 371 détectées, 2 371 réparées, 0 vide, 0 restante »**. C'était vrai. Et ça ne voulait
rien dire.

Les 2 371 étaient le compte de ce que MON expression de détection reconnaissait — trois
motifs relevés en regardant une dizaine de cas. Le soir, en mesurant un autre défaut, le
corpus a rendu **677 entrées de plus** portant exactement le même dégât sous d'autres
formes : `grosses` → « Rosses », `lamelles` → « Amelles », `clous` → « Ous », `demis` →
« Mis ». Mon « 0 restante » signifiait « 0 restante parmi celles que je sais voir ».

Le piège est propre et il se referme sans bruit : quand le même artefact SÉLECTIONNE la
population et MESURE la couverture, le taux de réussite vaut toujours 100 %. Un rapport
exhaustif n'exhausse rien s'il est produit par l'outil dont on teste la portée.

Ce qui aurait dû m'alerter : j'avais la SOURCE. `raw_text` était intact dans le seed, et il
suffisait de comparer chaque nom à ce que sa source contenait pour trouver les 677 — sans
énumérer un seul motif. J'ai préféré coder une liste de cas parce que les trois que j'avais
vus se ressemblaient, et une liste de cas ne trouve jamais le cas qu'on n'a pas vu.

**Règle** : pour mesurer la couverture d'un correctif, l'instrument doit être INDÉPENDANT du
correctif. Quand une source de vérité existe (texte d'origine, référentiel, second système),
compter les écarts CONTRE ELLE, jamais contre son propre prédicat. Et quand on énumère des
motifs, le dire — « 2 371 correspondant à trois motifs connus » aurait été honnête, là où
« 2 371 sur 2 371 » laissait croire à l'exhaustivité.

**Corollaire livré du même coup** : le correctif définitif n'énumère plus rien. `nomRestaure`
cherche dans la source le mot dont le nom ne garde qu'un suffixe et rend les lettres
manquantes — il attrape donc les formes que personne n'a répertoriées. Il refuse au-delà de
trois lettres perdues, parce qu'au-delà ce n'est plus une troncature mais un autre mot : une
règle dérivée de la MÉCANIQUE du dégât, pas de la liste de ses symptômes.

---

## 2026-08-19 — Un test de présence par sous-chaîne est satisfait par la ligne d'import

En livrant la réparation des noms d'ingrédients, j'ai posé un verrou : l'import du catalogue
doit lui aussi réparer, sinon une ré-importation ré-introduirait le défaut qu'on vient de
corriger. Le test :

```ts
expect(src).toContain("reparerNom");
```

Puis j'ai fait la passe de mutation : j'ai retiré l'APPEL dans le script d'import. **Le test
est resté vert.** La ligne `import { reparerNom } from …` contenait le mot, et ça suffisait.

Le verrou ne vérifiait donc pas ce qu'il prétendait : il attestait qu'on avait *importé* la
fonction, pas qu'on l'*appelait*. Il serait resté vert le jour où quelqu'un aurait simplifié
l'appel en laissant l'import — c'est-à-dire exactement le scénario contre lequel il existait.

**Règle** : un test qui cherche un identifiant par sous-chaîne dans un source doit chercher
la FORME D'APPEL (`/nom\s*\(/`), et écarter les lignes d'`import` avant de chercher. Plus
largement : quand un test porte sur du texte plutôt que sur un comportement, se demander
« quelle autre ligne du fichier pourrait le satisfaire ? ».

Ce n'est pas une leçon nouvelle — c'est « prouver qu'un test DISCRIMINE » appliquée à un cas
où l'intuition dit que c'est évident. Les trois autres mutations du même lot ont été
attrapées ; c'est celle dont j'étais le plus sûr qui ne l'a pas été. La passe de mutation ne
sert à rien si on la réserve aux tests dont on doute.

---

## 2026-08-19 — Le premier usage réel montre ce qu'aucune suite de tests ne regardait

Marc a branché le connecteur. J'ai appelé mes propres outils depuis claude.ai, sur sa base de
production — et la réponse, correcte sur toute la ligne côté mécanique, contenait ceci :

    manque 11 : Champignon De Paris Brun, Cubes De Bouillon De Volaille, Ousses D'Ail,
    S De Sel, Branches De Thym…

« **Ousses D'Ail** » : un « Gousses » amputé de sa première lettre. « S De Sel », « À Soupe De
Persil », « Huile végétale pure à ». À l'import du catalogue, la quantité et l'unité ont été
découpées DANS le nom de l'ingrédient au lieu d'en être extraites, et la coupe a parfois mordu
un caractère de trop.

Rien n'était rouge. 328 tests verts, le schéma respecté, l'agrégation juste, les prix estimés,
le MCP conforme. Le défaut n'est ni dans le code que j'ai écrit ni dans celui que j'ai testé :
il est dans la DONNÉE, entrée il y a des semaines, et il ne se voit que quand un humain lit la
sortie. Et il a une conséquence réelle que la mécanique ne peut pas signaler : le `canonical`
sert de clé de regroupement, donc « À Soupe De Persil » et « persil » font deux lignes qui ne
fusionneront jamais sur une liste d'épicerie.

Ce n'est pas la première fois dans ce dépôt qu'une couche saine sert de la donnée fausse — la
perte de 58 % des quantités avait la même forme. Le point commun : **un pipeline dont chaque
étage est correct peut transporter une entrée abîmée jusqu'à l'écran sans qu'aucun étage n'ait
de raison de s'en plaindre.**

**Règle** : livrer une surface de LECTURE (assistant, MCP, export, rapport) n'est fini que
lorsqu'on a lu une vraie sortie sur de vraies données, avec l'œil et pas avec un `expect`. Ce
qu'on cherche là n'est pas un plantage — il se signalerait tout seul — mais du contenu qui a
l'air d'un contenu. Cousin de la leçon JobAI sur le flux RSS d'Espresso-Jobs : « 200, XML bien
formé, 20 entrées », et la première entrée s'intitulait « TI : peut-on encore se priver des
femmes ? ».

**Corollaire** : ce défaut-là est rattrapable, contrairement à celui des unités — le catalogue
se rebâtit depuis `data/batchchef.seed.db`, qui porte les noms d'origine. C'est la leçon
« normaliser à l'écriture détruit la source » prise par le bon bout, pour une fois : la source
existe encore.

---

## 2026-08-19 — « Ça marche ailleurs » est une information, pas un compliment

Marc a écrit six mots : « me manque l'adresse, regarde ce que DriveAI a fait ça marche ».
J'avais livré le MCP le matin même, vérifié par onze sondes, et je venais de lui donner
l'adresse. Le réflexe naturel était de la redonner.

L'adresse était bonne. Ce qui manquait était invisible depuis le dépôt : l'interface
« Ajouter un connecteur personnalisé » de claude.ai ne prend **qu'une URL**, sans champ pour
un en-tête. Mon serveur, gardé par un `Authorization` statique, y reçoit une requête sans
jeton, répond 401 — et comme ce 401 ne porte rien à découvrir, le connecteur échoue sans rien
expliquer. Aucune relecture du code, aucun test, aucune sonde HTTP ne pouvait le montrer :
le serveur répondait exactement ce qu'on lui avait demandé de répondre.

Ce qui a tranché, c'est d'aller regarder ce qui MARCHE. La configuration MCP réelle de la
session montrait `financeAImcp` branché sur une **URL nue** — donc l'authentification ne
passait pas par un en-tête. Puis son code, dont l'en-tête disait déjà tout : *« pourquoi pas
un simple Bearer statique : l'UI des connecteurs custom de claude.ai n'offre QUE OAuth
(vérifié 2026-07-13) »*. Le même mur, dans le même écosystème, quarante jours plus tôt, avec
son remède écrit à côté.

J'avais pourtant noté ce risque la veille au backlog (`MCP-03`, « peut-être OAuth »). Le noter
ne suffisait pas : je l'avais rangé dans « à constater au premier branchement réel », alors
que la réponse était lisible **immédiatement** dans un dépôt voisin que j'avais déjà ouvert.
Un inconnu qu'on peut lever en dix minutes n'est pas un inconnu, c'est une vérification
qu'on remet.

**Règle** : quand quelqu'un dit « ça marche là-bas », ce n'est pas une comparaison, c'est
l'endroit où aller lire. Et avant de classer un point en « à vérifier plus tard », se
demander si un projet voisin l'a déjà rencontré — dans un écosystème qui partage ses
contraintes, le mur qu'on va prendre a souvent déjà été pris, et le compte rendu est dans le
dépôt d'à côté.

**Corollaire technique, du même incident** : un garde-fou qui protège quelque chose se
transporte AVEC ses raisons, pas seulement avec son code. En reprenant l'OAuth de FinanceAI
j'ai repris six contrôles (origine exacte, PKCE, type dans la charge, usage unique, rotation,
temps constant) dont chacun venait d'un finding de revue. Les recopier sans leur « pourquoi »
en aurait fait des lignes qu'une refactorisation future simplifierait sans le savoir. Chacun
porte donc, dans le test qui le couvre, la phrase qui dit ce que son absence coûterait.

**Corollaire d'adaptation** : un garde repris d'ailleurs se re-juge sur SA plateforme. La
liste des codes déjà consommés vit en mémoire chez FinanceAI, ce qui tient sur une instance
Cloud Run chaude ; recopiée telle quelle sur Vercel, elle n'aurait rien protégé — instances
froides et parallèles, mémoire vierge à chaque rejeu. Elle est passée en base. « Ça marche
là-bas » ne veut pas dire « ça marchera ici » : c'est la contrainte qui voyage, pas
l'implémentation.

## 2026-08-19 — L'exemption de build ne survit pas au redémarrage d'une branche

J'ai annoncé à Marc qu'un commit de documentation seule ne coûterait aucun déploiement —
l'`ignoreCommand` (`scripts/build-necessaire.sh`) exempte `*.md`. Le preview a construit.

Le commit d'AVANT, lui aussi documentation seule, avait bien été `Ignored`. Seule différence :
il vivait dans une branche continue, alors que celui-ci est le PREMIER commit après un
`checkout -B <branche> origin/master` consécutif au squash-merge.

Le script diffe contre `VERCEL_GIT_PREVIOUS_SHA`, c'est-à-dire le commit du dernier
déploiement de cette branche — ici `49f8e30`, que le squash a rendu **orphelin**
(`git merge-base --is-ancestor 49f8e30 25cc145` → non). Aucune profondeur de clone ne peut
le contenir, puisqu'il n'est plus sur la branche du tout. `git diff` échoue, et le script
tombe sur son garde documenté : *toute incertitude se résout en CONSTRUISANT*.

Vérifié plutôt que supposé : rejoué localement avec la même base, le diff ne contient que
quatre `.md` — donc s'il avait été calculable, le script aurait bien ignoré le build. Le
script a fait exactement ce pour quoi il a été écrit ; c'est ma prédiction qui était fausse.

Confirmé par prédiction dans la foulée : le commit SUIVANT sur la même branche, lui aussi
documentation seule, a bien été `Ignored` — sa base (`25cc145`) était redevenue atteignable.
Seul le premier commit après le redémarrage payait. Un mécanisme n'est compris que quand il
prédit le cas d'après, pas seulement quand il explique celui d'avant.

**Règle** : l'exemption « doc/tests ne coûtent pas de déploiement » ne vaut qu'à l'INTÉRIEUR
d'une histoire de branche continue. Le premier commit après un squash-merge repart d'une base
que le distant ne connaît plus, et construit quoi qu'il contienne. Corollaire pratique : un
lot de documentation posté juste après un merge se groupe avec le suivant, ou s'accepte comme
un déploiement. Et corollaire général — c'est la deuxième fois de la session : **une garde
qui se calibre sur un état antérieur (SHA précédent, délai de retente, cache) change de
comportement quand cet état est réécrit**, sans que rien ne le signale.

## 2026-08-19 — La protection d'hébergement peut rendre un endpoint machine injoignable, et ça ne ressemble pas à une erreur

Le serveur MCP validé, j'ai voulu le sonder sur la préversion Vercel. Réponse : **302 vers
`vercel.com/sso-api`**. Ce n'était pas mon middleware — c'était la protection Vercel du
projet, qui s'applique AVANT que l'app ne tourne.

En le vérifiant plutôt qu'en le supposant : `ssoProtection.deploymentType =
"all_except_custom_domains"`. Autrement dit **toute** URL `*.vercel.app` est protégée, y
compris l'alias de production `batchchef-glu8-chi.vercel.app` — et seuls les domaines
personnalisés (`batchchef.hubperso.com`) sont exemptés.

Ce qui rend ça dangereux, c'est la FORME de l'échec. Un client MCP pointé sur la mauvaise
URL ne reçoit pas « accès refusé » : il reçoit une redirection vers une page de connexion
HTML. Selon le client, ça donne « réponse invalide », un JSON illisible, ou un silence. Rien
n'y dit « ton URL est protégée » — et l'app, elle, marche parfaitement dans le navigateur de
Marc, qui a une session Vercel. Cousin exact du piège n°1 du squelette (l'endpoint hub sous
le middleware de session : redirection HTML au lieu du JSON), sauf que cette fois la garde
n'est pas dans le code du tout, donc aucune relecture du dépôt ne peut la trouver.

**Règle** : pour toute surface appelée par une MACHINE, l'URL fait partie du contrat, et la
protection de l'hébergeur fait partie de la surface. Vérifier le réglage réel (pas la page
qui s'ouvre dans son navigateur), et écrire l'URL exacte dans la doc avec la raison — sinon
le premier essai de Marc échoue sur un symptôme qui n'accuse rien.

## 2026-08-19 — Un endpoint qui COMPILE n'est pas un endpoint qui RÉPOND

Le serveur MCP a passé le gate complet — `typecheck`, `lint`, 291 tests, `build` — et la
sortie du build affichait fièrement `ƒ /api/mcp`. J'allais m'arrêter là et l'annoncer livré.

J'ai démarré le build localement et je l'ai appelé pour de vrai. Onze sondes : négociation de
version, `tools/list`, notification sans réponse, 401 sur jeton faux **et** absent, 405 sur
GET, lot de trois entrées rendant deux réponses, méthode inconnue, panne d'outil, outil
inconnu, 503 sans `MCP_TOKEN`. Tout est passé — mais **aucun de ces onze points n'était
prouvé par le gate**. Les tests couvrent des fonctions pures ; le build couvre la
compilation. Personne ne vérifiait que le `switch` du handler câble bien ces fonctions à ces
codes HTTP. Un `case` mal orthographié, un `return` oublié, une réponse renvoyée à un
notification : vert partout, serveur muet en production.

C'est la version « endpoint » d'une règle que ce dépôt connaît déjà sous d'autres formes —
« CI verte ≠ en ligne », « un `clasp push` vert ne prouve pas que le code a pris effet »,
« un HTTP 200 ne prouve rien tant qu'on n'a pas mesuré ce que l'API répond à une question
absurde ». Le point commun : **le statut d'une opération ne dit pas ce qui tourne**.

La sonde a aussi rendu quelque chose qu'aucun test n'aurait donné : la certitude que la
négociation renvoie bien `2025-06-18` quand on le demande, et pas notre version à nous. Un
test l'affirme sur la fonction pure ; seule la sonde le prouve sur le chemin complet.

**Règle** : pour une surface appelée par une MACHINE (endpoint, webhook, cron), le gate ne
suffit pas — il faut au moins une passe d'appels réels contre le build, couvrant le chemin
NOMINAL *et* chaque mode d'échec qu'on prétend distinguer (401 vs 503 vs 405). Ça coûte cinq
minutes et un `next start` ; ne pas le faire, c'est découvrir le câblage au premier usage de
Marc.

**Corollaire outillage, appris en le vivant deux fois dans la même session** : `pkill -f
"next start -p 3111"` tue le shell qui l'exécute — le motif matche sa propre ligne de
commande, et le tour se termine sur un exit 144 sans qu'on comprenne pourquoi. Tuer par PID.
Même famille que « un `| grep` masque le code de sortie » : l'outil de vérification fait
partie de ce qu'il faut vérifier.

## 2026-08-19 — Un « borner » qui rabat sur une valeur par défaut fabrique une réponse fausse

En relisant la boucle de l'assistant — jamais exécutée, la session qui l'a écrite n'ayant pas
de réseau vers l'API — j'ai trouvé ceci :

```ts
const id = borne(args.id, 0, Number.MAX_SAFE_INTEGER);   // Math.min(Math.max(v, 1), max)
```

Un id absent, nul, négatif ou envoyé en chaîne devenait **1**. L'assistant lisait donc la
recette n°1 et la citait à Marc comme la réponse à sa question, avec numéro et ingrédients à
l'appui. Aucune erreur nulle part.

Le mot « borner » est le piège : borner une DIMENSION (une limite de résultats, une durée) est
sain — on veut une valeur dans un intervalle. Borner un IDENTIFIANT n'a aucun sens : un id
hors domaine n'est pas « trop petit », il est **absent**. Rabattre revient à répondre à une
autre question que celle posée.

**Règle** : un identifiant se valide et se REFUSE, il ne se borne jamais. Plus largement,
avant d'écrire un `clamp`, se demander si la valeur vit sur un CONTINUUM (borner) ou désigne
une ENTITÉ (refuser). Et se méfier d'un helper générique réutilisé pour les deux.

**Troisième défaut du même passage, même famille** : `stop_reason` n'était pas lu. Une
réponse coupée par le plafond de jetons s'arrête EN PLEIN MILIEU d'une phrase — rendue telle
quelle, elle a l'air complète, et Marc lirait une recette dont la dernière étape manque sans
rien pour le lui dire. Le point commun des trois : **du code qui produit un résultat
plausible là où il devrait admettre qu'il n'en a pas**. C'est ce que la relecture doit
chercher en priorité dans du code non exécuté — pas les plantages, qui se signalent seuls.

Corollaire du même passage : la sortie d'un outil aussi est une entrée qui croît (la
préparation d'une recette fait des kilo-octets, × 8 allers-retours). Elle est maintenant
bornée, et la troncature est DITE — sinon le modèle croirait avoir tout lu et pourrait citer
une étape qui n'existe pas.

---

## 2026-08-19 — Normaliser à l'écriture DÉTRUIT la source, donc rend le correctif suivant impossible

Le pipeline convertissait les unités au moment de l'import et ne gardait que le résultat
(`g`/`ml`/`unite`). Quand la conversion échouait, la quantité tombait en « au goût » — et le
mot d'origine (« gousses », « cans ») était perdu définitivement.

La conséquence n'apparaît qu'au correctif SUIVANT : le 19/08, élargir la table d'unités a
réparé tout ce qui arriverait désormais, et **rien** de ce qui était déjà en base. Pas parce
que le rattrapage était coûteux — parce que la donnée nécessaire n'existait plus nulle part.
J'allais l'annoncer comme « les quantités sont réparées » ; c'était vrai pour le futur et
faux pour ce que Marc allait ouvrir en premier, c'est-à-dire ses recettes existantes.

**Règle** : quand un traitement NORMALISE une entrée à l'écriture, garder la forme brute dès
qu'on n'a pas su la traiter. Ça coûte une colonne ou un champ de note ; ne pas le faire rend
tout élargissement futur inapplicable à l'existant, et on ne s'en aperçoit que le jour où on
l'élargit. Cousin de la leçon JobAI « le chemin de rattrapage se livre DANS le même lot que
la colonne » — ici, ce n'est même pas un chemin qui manquait, c'est la matière.

---

## 2026-08-17 — Livré le matin, retiré le soir : la leçon n'est pas « j'ai eu tort de coder »

Le stock de portions et le garde-manger ont été conçus, testés, mergés et déployés dans la
journée — puis retirés le soir, Marc n'en voulant pas. Ce qu'il a gardé de la conversation,
c'est le BESOIN sous-jacent (« je veux plus que ça me demande d'acheter du sel »), pas la
solution que j'avais proposée pour y répondre.

Deux choses à en tirer, et une à ne PAS en tirer.

À en tirer : (a) une solution DÉCLARATIVE (une liste que l'utilisateur tient à jour) est un
coût permanent qu'on lui impose — Marc a refusé de tenir un placard, pas de ne plus acheter
de sel ; (b) le fait que j'aie posé la question de cadrage avant de coder n'a rien empêché,
parce que mes trois options portaient toutes sur le COMMENT et aucune sur le SI.

À ne pas en tirer : « il aurait fallu attendre ». Le travail retiré était propre, mergeable,
et son retrait a coûté une heure parce qu'il était bien rangé (fichiers dédiés, deux tables
isolées, aucune dépendance croisée). C'est ça qui rend un retrait bon marché — pas le fait
de ne pas avoir codé.

---

## 2026-08-17 — Un compteur qui ne filtre rien se dégrade, donc on cesse de le lire

L'accueil affichait « Articles à acheter » en comptant tous les `shopping_items` non cochés,
**sans jointure sur `batches`**. Un batch terminé dont il restait des lignes jamais cochées
gonflait ce chiffre pour toujours.

Ce n'est pas un bug qui casse : c'est un chiffre qui devient faux **lentement**. Personne ne
le signale, on s'habitue à ce qu'il soit gros, et le jour où il compte vraiment il ne veut
plus rien dire. Même famille que « une CI rouge en permanence cesse d'être lue ».

**Règle** : un compteur agrégé doit nommer son PÉRIMÈTRE dans la requête. « Tout ce qui n'est
pas coché » n'est pas un périmètre, c'est l'absence de filtre.

---

## 2026-08-17 — Un test peut passer pour la mauvaise raison, et seule la mutation le dit

En écrivant `tests/portions.test.ts`, j'ai posé un test « date dans le fuseau de Marc, jamais
en UTC » avec deux instants du même soir : `2026-08-11T01:00:00Z` et `2026-08-11T02:00:00Z`.
Les deux tombent le 10 août à Toronto — et **le 11 août en UTC, tous les deux aussi**. La
différence de jours valait donc 0 dans les deux implémentations : le test était **vacueux**.

Il est passé au vert, à côté de dix-neuf autres tests verts. Rien ne le distinguait.

C'est la passe de mutation qui l'a révélé : en remplaçant `timeZone: FUSEAU` par
`timeZone: "UTC"`, le test qui est tombé n'était pas celui-là mais son voisin (« jours de
calendrier »). Un test de mutation ne prouve pas seulement qu'une régression serait
attrapée — **il dit PAR QUEL test**, et c'est là qu'un test décoratif se démasque.

**Règle** : pour prouver qu'un test discrimine sur un axe, la mutation de CET axe doit faire
tomber CE test. S'il tombe ailleurs, le test ne verrouille pas ce qu'il prétend. Corrigé avec
deux instants du même jour local mais de deux jours UTC différents (16 h et 22 h à Toronto).

---

## 2026-08-17 — Le vrai garde d'idempotence n'est pas toujours le statut

*(Le code cité a été retiré le soir même — Marc n'a pas voulu du stock de portions. La règle,
elle, reste vraie et s'appliquera au prochain garde qu'on écrira.)*

`terminerBatch` fabriquait un stock. Le réflexe est de refuser quand le batch est déjà
`termine`. Ça couvre le double envoi et le retour arrière du navigateur — mais **pas**
`terminé → cuisine → terminé`, qui remet le statut à zéro et rouvre la porte en grand.

Le garde correct est l'EFFET, pas l'état qui l'a déclenché : « ce batch a-t-il déjà produit
ce que l'action produit ? ». Sans ça, on annonce deux fois plus que la réalité — un mensonge
silencieux, du genre qu'on ne découvre qu'en ouvrant le placard.

**Règle** : pour un garde d'idempotence, se demander « quel changement d'état RÉOUVRE ce
chemin ? ». Si un aller-retour légitime le réarme, le garde doit porter sur ce que l'action
PRODUIT, pas sur le statut qui l'autorise.

---

## 2026-08-17 — Tailwind génère du CSS depuis la prose qui parle du CSS

En vérifiant en production le correctif de la régression « texte blanc sur blanc », la
feuille servie contenait encore `.bg-white` et `.dark\:bg-stone-900`. De quoi croire à une
rechute — et j'ai enquêté.

Aucun balisage ne les utilisait : Tailwind v4 balaie **tout le dépôt**, commentaires et
Markdown compris, et c'est la prose qui RACONTE le bug (le commentaire du test, la leçon de
`CLAUDE.md`) qui générait ces règles. Cousin du garde de JobAI qui bloquait sur la chaîne
prouvant qu'il détectait quelque chose : il détectait le détecteur.

**Règle** : ce qui tranche est le **HTML servi** (la classe rendue), jamais la présence
d'une règle dans la feuille.

---

## 2026-08-14 — Un remplacement ordonné qui supprime le correctif avant l'original

Ma passe de refonte visuelle a remplacé les variantes `dark:bg-stone-900` par des jetons **en
laissant en place le `bg-white` en dur qu'elles corrigeaient**. En thème sombre : fond blanc
figé sous un texte clair hérité. Vingt-et-un endroits, aucun test rouge, aucune erreur.

C'est Marc qui l'a vu, sur son téléphone.

**Règle** : une couleur figée est **invisible à la relecture** — elle est parfaitement lisible
dans le thème pour lequel on l'a écrite. Il faut une machine qui les compte
(`web/tests/theme.test.ts`), et sa portée doit être `git ls-files` **plus le neuf non
ignoré**, sinon le garde ne voit la faute qu'une fois commise.

---

## 2026-08-17 — Une PR qui pourrit n'a pas forcément tort

La PR #44 (Web Analytics) était en conflit depuis quatre jours. La cause n'était pas la PR :
c'est `master` qui avait bougé sous elle de dix commits, dont une refonte qui réécrivait le
fichier qu'elle touchait. Son apport réel tenait en deux lignes.

Reconstruire l'intention sur `master` a coûté moins qu'une fusion de lockfile à la main.
Deux contrôles ont fait le travail : l'apport net contre `master` (**46 insertions, zéro
suppression** — une suppression aurait voulu dire qu'un morceau de la refonte repartait avec),
et la cohérence du lockfile auto-fusionné (`npm ci --dry-run`, puis `npm install` qui ne le
retouche pas).

**Règle** : sur une résolution de conflit, le contrôle qui compte est le **diff net contre la
base**, pas l'absence de marqueurs de conflit.
