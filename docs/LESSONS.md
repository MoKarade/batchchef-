# Leçons — BatchChef

> Ce qui a été appris **en le vivant**, pas en le supposant. Une leçon dont la règle change
> la façon de coder remonte dans `CLAUDE.md` ; le récit reste ici.
>
> Convention de l'écosystème (DriveAI, JobAI). Créé le 2026-08-17 : les leçons de ce dépôt
> vivaient jusque-là dans `CLAUDE.md` ou nulle part.

---

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
