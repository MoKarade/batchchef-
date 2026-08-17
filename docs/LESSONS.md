# Leçons — BatchChef

> Ce qui a été appris **en le vivant**, pas en le supposant. Une leçon dont la règle change
> la façon de coder remonte dans `CLAUDE.md` ; le récit reste ici.
>
> Convention de l'écosystème (DriveAI, JobAI). Créé le 2026-08-17 : les leçons de ce dépôt
> vivaient jusque-là dans `CLAUDE.md` ou nulle part.

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

`terminerBatch` fabrique le stock. Le réflexe est de refuser quand le batch est déjà
`termine`. Ça couvre le double envoi et le retour arrière du navigateur — mais **pas**
`terminé → cuisine → terminé`, qui remet le statut à zéro et rouvre la porte en grand.

Le garde correct est l'EFFET, pas l'état qui l'a déclenché : « ce batch a-t-il déjà des
portions ? ». Sans lui, l'app annonce deux fois plus de repas qu'il n'y en a — un mensonge
silencieux qu'on ne découvre qu'en ouvrant un congélateur vide.

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
