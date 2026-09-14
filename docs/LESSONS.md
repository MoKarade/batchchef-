# Leçons — BatchChef

> Ce qui a été appris **en le vivant**, pas en le supposant. Une leçon dont la règle change
> la façon de coder remonte dans `CLAUDE.md` ; le récit reste ici.
>
> Convention de l'écosystème (DriveAI, JobAI). Créé le 2026-08-17 : les leçons de ce dépôt
> vivaient jusque-là dans `CLAUDE.md` ou nulle part.

---

## 2026-08-20 — Compter un symptôme n'est pas l'avoir compris

Le chantier catalogue a produit six inventaires. **Trois se sont effondrés au contact des
données**, et à chaque fois le compte était juste — c'est la conclusion qui était fausse.

**« 22 recettes creuses à un seul ingrédient. »** Le compte était exact. Ce sont « Oeufs
durs » (4 oeufs), « Purée d'amande » (250 g d'amandes), « Compote de nectarines », et les
cinq « Confiture de lait » déclinées par appareil. Un seul ingrédient n'est pas un défaut,
c'est à quoi ressemble une recette simple. J'avais obtenu de Marc l'autorisation de les
supprimer **pour de bon** sur la foi de ce cadrage. Les avoir ouvertes une par une avant
d'écrire la moindre ligne est la seule raison pour laquelle elles existent encore.

**« 6 instructions avec du mojibake. »** Il y en avait zéro. Mon motif cherchait `Ã|Â|â€`
et attrapait le « À » de « À feu doux » — la lettre française la plus banale. Le détecteur
produisait le défaut qu'il prétendait mesurer.

**« 26 lignes d'ingrédients irréductibles. »** 18 étaient réparables. Je les avais classées
irréductibles parce que ma règle de restauration refusait de rendre plus de deux lettres —
un garde utile, posé pour la bonne raison (à trois, « Ail » devenait « Portail »). Mais la
colonne `unit` du seed portait « tasse » et le texte source portait « tasses » : il n'y
avait rien à deviner, seulement à vérifier que le mot reconstruit existe littéralement.

Le point commun : **j'avais diagnostiqué depuis une SORTIE — un compte, une distribution —
au lieu de la mécanique qui la produit.** Une sortie dit qu'il y a un problème, jamais
lequel. C'est la même faute que l'ADR-0005 de JobAI, trois de ses quatre conclusions
réfutées par la lecture du code.

Ce qui a marché, et qu'il faut garder : **ouvrir les objets avant de décider de leur sort**.
Quinze minutes à lire 40 titres ont évité de détruire 22 recettes légitimes et ont réduit un
lot de 40 à 18 — pas en étant prudent, en étant précis.

Deux corollaires méthodologiques du même jour :

- **Un test de mutation ne vaut que si le cas testé EXERCE la règle.** J'ai voulu prouver
  qu'on ne groupe pas deux recettes vides entre elles ; mon test leur donnait deux titres
  différents, donc elles ne se groupaient de toute façon jamais. La mutation passait au vert.
  Corriger le test (même titre) l'a fait tomber immédiatement. Écrire la mutation AVANT de
  se féliciter du test est ce qui l'a révélé.
- **Un plafond de sécurité se pose serré sur un corpus figé.** Le catalogue est committé :
  le nombre de retraits est une VALEUR (18), pas une borne. Le plafond est à 25, et il fait
  échouer le build. Un plafond large ne protège de rien.

---

## 2026-08-20 — Un `as unknown as` fait taire le seul outil qui aurait vu l'erreur

La passe de réparation traite deux couples de tables identiques *en apparence* : le catalogue
(`catalog_recipes` / `catalog_ingredients`) et la bibliothèque (`recipes` /
`recipe_ingredients`). Mêmes colonnes utiles, même traitement. J'ai donc écrit une seule
fonction et je lui ai passé le second couple avec un `as unknown as`.

Sauf que la clé étrangère s'appelle `catalog_recipe_id` d'un côté et `recipe_id` de l'autre.
Ma fonction lisait `catalogRecipeId` dans les deux cas. Sur la bibliothèque, cette propriété
vaut `undefined` — et le cast avait explicitement retiré à TypeScript le droit de le dire.

Le résultat n'est pas un joli message d'erreur. C'est, **en production**, au milieu du build :

```
TypeError: Cannot convert undefined or null to object
    at Object.entries … orderSelectedFields … PgSelectBase._prepare
```

Rien ne nomme la colonne, rien ne nomme la table. Et la passe était déjà allée au bout du
catalogue (9 526 recettes migrées) avant de mourir sur la bibliothèque : un état à moitié
fait, dont seul le hasard de l'ordre décidait de la moitié survivante.

**La leçon n'est pas « j'ai fait une faute de frappe ».** C'est que j'ai supprimé la
vérification qui l'aurait attrapée, pour économiser une duplication de quinze lignes. Le
typecheck était vert — il ne pouvait pas être autre chose.

Correctif structurel : **les LECTURES sortent de la fonction**, chez l'appelant, écrites avec
les vrais types de chaque table. TypeScript retrouve le droit de parler, et il aurait refusé
`catalogRecipeId` sur `recipeIngredients`. Le cast ne subsiste que sur les ÉCRITURES, qui
n'emploient que des colonnes présentes des deux côtés — et cette affirmation-là est
maintenant un test, pas une conviction : il vérifie la présence de chaque colonne écrite dans
les deux couples, et il vérifie que les deux clés étrangères portent bien des noms
DIFFÉRENTS, pour que la prochaine session voie le piège avant de le reproduire.

Règle qui en sort : **avant d'écrire `as unknown as`, se demander ce que le compilateur
allait dire.** Si la réponse est « je ne sais pas », c'est exactement l'information qu'on est
en train de jeter. Deux tables qui se ressemblent ne sont pas la même table, et « je vérifie
que ça marche » ne remplace pas un type — surtout quand le seul endroit où ça s'exécute
vraiment est un build de production.

## 2026-08-19 — Un audit ne mesure que l'axe qu'il regarde, et le sien paraît complet

`ING-06` avait conclu « 99,85 % correct » sur 87 443 lignes d'ingrédients. Le chiffre était
juste — pour ce qu'il mesurait. Il jugeait le **nom** et l'**unité** de chaque ligne, et ne
touchait à la **quantité** que par l'absurde : un zéro, un compte à quatre chiffres. Autrement
dit, il repérait une quantité qui n'a plus l'air d'une quantité, jamais une quantité qui a
l'air juste et ne l'est pas.

Marc a demandé de creuser encore. En cherchant un axe que l'audit n'avait pas, un invariant
est apparu : dans une recette, le rapport « nombre du texte source / quantité par portion »
doit valoir le MÊME rendement sur toutes les lignes — c'est le diviseur que la V3 a appliqué
partout. **2 671 lignes s'en écartaient**, vingt fois le reliquat annoncé la veille.

Ce qu'elles cachaient était sérieux : « 1/2 kg de viande hachée » était enregistré 1 kg. Une
fraction en tête était lue « 1 » — 2 508 lignes, vérifié dénominateur par dénominateur (2 141
demis, 186 quarts, 16 trois-quarts). Sur une liste d'épicerie, ça veut dire acheter le double,
et payer le double, sans qu'aucun écran ne montre quoi que ce soit d'anormal.

**La leçon n'est pas « j'ai raté quelque chose », c'est que le TAUX n'a de sens qu'avec l'axe.**
« 99,85 % correct » se lit comme un jugement sur la donnée ; ce n'était qu'un jugement sur deux
de ses trois colonnes. Un audit devrait donc annoncer ce qu'il ne regarde pas aussi
explicitement que son résultat — sinon le chiffre couvre le silence.

Corollaire de méthode, déjà rencontré avec `ING-03` (« mesurer la complétude avec l'instrument
qui définit le périmètre ne mesure rien ») : la parade n'est pas de mieux chercher avec le même
outil, c'est de **trouver un invariant que les règles de correction n'utilisent pas**. Ici le
rapport au rendement ne sert à aucune des trois règles de réparation ; c'est ce qui lui permet
de les juger. Il est maintenant dans la suite de tests, sur le corpus entier.

Et trois pièges rencontrés en le construisant, tous des faux positifs de mon propre instrument :

- **Un tiret en tête est une puce de liste, pas un signe.** « -1 gousses d'ail »,
  « -4600 g de pomme de terre » : le lire comme un moins produisait une quantité négative,
  donc 43 lignes jugées fautives alors que la V3 avait raison.
- **Une fourchette n'est pas un nombre.** « 2 à 3 cuillères » : en choisir une borne invente
  une certitude que la source ne donne pas, et l'écart qui en résulte ne prouve rien.
- **Deviner une PIÈCE n'est pas deviner une MESURE.** « branche de persil » se lit « une
  branche » ; mais « clou de girofle », dont la colonne `unit` du seed porte `cl` (le « cl »
  de « clou » — encore la frontière de mot), aurait donné **10 ml**, et « lamelle de truffe »
  **un litre**. Le garde ne peut pas être une liste de mots : il doit regarder l'unité
  d'arrivée. 49 lignes.

Enfin, un cas où l'honnêteté coûte un chiffre : 136 recettes ont été divisées par un nombre
qui n'est pas un rendement (500, 1 250, 10 000). Leurs rapports internes sont justes, l'échelle
est perdue, et rien ne dit par quoi multiplier — « 200 g de thon » s'affichait « 0,02 g ». Ces
820 lignes passent « au goût », avec le texte source en note. On perd un nombre ; on cesse
d'affirmer un nombre faux à chaque affichage.

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

## 2026-08-19 — Un audit sérieux commence par auditer l'instrument

Marc a demandé une vérification en profondeur des 87 443 lignes d'ingrédients : « assure-toi
qu'au moins 98 % est bon ». Premier verdict : **99,63 %**. Verdict final, après avoir corrigé
l'audit LUI-MÊME trois fois : **99,85 %**, mais en ayant découvert entre-temps 800 lignes de
défauts que la première mesure ne voyait pas et 250 qu'elle inventait.

Les trois fautes de l'instrument, toutes de la même famille :

1. `\b` en JavaScript ne considère pas `è` comme une lettre. Donc `/\bde\b$/` matche la fin
   de « Eau Tiède » : 60 noms parfaitement corrects signalés comme tronqués. Et
   symétriquement `/\bà\b$/` ne matchait JAMAIS « pure à », donc le vrai défaut passait.
   Un même bug faisait les deux erreurs à la fois, dans les deux sens.
2. Le critère « nom dégénéré » comptait les premiers mots courts. « Os À Moelle » et
   « St Morêt » sont corrects ; « Es » ne l'est pas. La brièveté n'était pas le signal — le
   fait d'être le RESTE d'un mot présent dans la source l'était.
3. Le critère « volume rendu en masse » cherchait « cuillère » n'importe où dans le texte, et
   attrapait « 100 g de farine + 1 cuillerée pour le moule », qui est en grammes à juste titre.

Chaque correction faisait bouger le chiffre dans les deux sens — parfois vers le bas, parce
qu'on voyait enfin ce qu'on ratait. **Un taux qui ne bouge jamais quand on affine la mesure
est un taux qu'on n'a pas mesuré.**

Et l'audit, une fois juste, a trouvé trois vrais défauts que ni les tests ni les logs
n'auraient montrés — dont deux dans mes propres correctifs de la veille : une restauration
qui trouvait l'unité avant l'ingrédient (198 lignes perdues à cause d'UNE ligne mal lue,
parce que le désaccord annulait les deux), et un nettoyage qui passait par une carte de
correspondance dont il n'avait aucun besoin, donc bloqué par des conflits sans rapport.

**Règle** : avant de rapporter un taux, chercher les faux positifs ET les faux négatifs de
son propre critère, sur des exemples qu'on LIT. Un audit se calibre comme un instrument :
ici, en rejouant l'état de production depuis la source PUIS en le confrontant à la vraie base
par un autre chemin (le MCP, 11 ingrédients sur 11). Sans cette calibration, j'aurais audité
un modèle de la production, pas la production.

**Corollaire** : chaque correctif doit être re-mesuré sur le corpus ENTIER, pas sur son cas
motivant. L'une de mes corrections a fait tomber le taux de 99,62 % à 98,91 % — elle réparait
198 lignes et en cassait 595, ce que le cas motivant ne pouvait pas montrer. Sans re-mesure
complète, je l'aurais livrée en croyant l'avoir améliorée.

---

## 2026-08-19 — Une abstention EN BLOC écarte les champs sur lesquels tout le monde était d'accord

J'avais promis à Marc une « preuve par l'usage » : relire la liste d'épicerie après le
correctif d'unités et vérifier que l'ail n'était plus en grammes. Je l'ai fait. Il l'était
toujours — **« Gousses D'Ail — 3 g »**, inchangé, alors que la passe annonçait 1 664 lignes
corrigées et que les tests étaient verts.

Deux fautes empilées, toutes deux de moi.

La première est une regex. Le corpus contient **« -1 gousses d'ail »** — quantité négative.
Mon extracteur de quantité ne connaissait pas le signe, donc il ne retirait rien, donc le
texte ne commençait par aucune unité connue, donc cet ingrédient passait pour « indéterminé ».

La seconde est la vraie leçon. Ma règle disait : *si deux entrées sources retombent sur la
même clé avec des corrections différentes, on n'y touche pas*. Prudent en apparence. Mais
les deux entrées de l'ail ne divergeaient que par la CASSE du nom (« Gousses D'Ail » contre
« Gousses d'ail ») — et mon abstention **globale** jetait avec elles la correction d'unité,
sur laquelle elles étaient parfaitement d'accord. Un désaccord sur le nom n'apprend
strictement rien sur l'unité.

Résultat : la clé la plus fréquente du corpus (1 482 lignes d'ail) était exactement celle qui
échappait au correctif. La prudence mal placée n'est pas de la prudence, c'est un angle mort
— et il visait le cas principal.

**Règle** : une abstention se décide CHAMP PAR CHAMP. Quand plusieurs sources contribuent à
une même cible, chaque champ a son propre quorum ; refuser en bloc, c'est laisser un
désaccord cosmétique bloquer une correction critique. Mesuré ici : 136 des 161 conflits
portaient sur un seul champ, l'autre étant unanime.

**Et la règle de méthode qui l'a attrapé** : c'est la preuve PAR L'USAGE qui a révélé les
deux fautes, pas les tests. Les 362 tests étaient verts, la passe rapportait des milliers de
lignes corrigées, les logs de build étaient propres. Seule la relecture de la vraie liste
d'épicerie — celle que Marc lirait — montrait que le cas qui avait motivé tout le chantier
n'était pas réglé. Un correctif n'est pas vérifié par son compteur : il est vérifié en
regardant la chose qu'on voulait corriger.

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

## 14/09/2026 — la proposition de la semaine (`SEM-02`)

**Un test de corpus doit porter sur l'ensemble que la PRODUCTION utilise, pas sur le plus
grand qu'on ait sous la main.** Mon premier test balayait les 52 semaines de 2026 sur les
10 188 recettes, et il était vert. Mais la production ne passe jamais 10 188 recettes au
tirage : charger leurs 87 444 lignes d'ingrédients à chaque fabrication serait absurde, donc
elle en présélectionne **200** en SQL. Le test prouvait donc une propriété — « la variété
tient toujours » — sur un objet que le code n'emprunte pas. Mesuré ensuite sur des
présélections : la variété tient dès **40** recettes (0 relâchement sur 52), et l'échange
« au moins une courte » est sollicité 5 fois sur 52 à 200. La propriété était vraie, mais je
ne l'avais pas prouvée là où elle compte. Même famille que
`CORRECTIF-VERT-EN-TEST-INERTE-EN-PROD` de FinanceAI : la question n'est pas « mon test
passe-t-il ? » mais « teste-t-il ce qui tourne ? ».

**Une mutation muette dit d'abord que la FIXTURE ne l'atteint pas.** Ma quatrième mutation
(supprimer le bloc qui garantit une recette courte) a fait rougir le test de corpus mais PAS
le test dédié qui portait ce nom. Cause : sous la graine `2026-W38`, la recette courte de ma
fixture arrivait **première** dans l'ordre déterministe — elle était donc retenue sans le
bloc, et le test passait sans rien prouver. Mesuré sur cinq graines, `2026-W40` la place
**dernière des sept** : c'est là, et seulement là, que le bloc d'échange est le seul à pouvoir
la faire entrer. La graine d'un test déterministe n'est pas un détail de décor, elle fait
partie de l'assertion — et le commentaire doit dire POURQUOI c'est celle-là.

**Deux sections au même titre dans un document « à lire en premier » en cachent une.** Le
`HANDOVER.md` portait deux fois « Ce qui vient d'être livré (19/08/2026, soir) », avec un
paragraphe entier dupliqué mot pour mot, la section du 17/08 coincée entre les deux, et la
seconde contenant tout le travail MCP. Un lecteur qui s'arrête au premier titre — c'est-à-dire
tout lecteur — rate la moitié de la journée. Réparé en distinguant les titres par leur contenu
réel et en retirant le doublon. La règle : un titre répété n'est pas une coquille, c'est un
document qui a perdu sa table des matières.

**Un repli qui fait DISPARAÎTRE l'élément est un silence, pas une dégradation.** Mon premier
jet enveloppait la fabrication de la semaine dans un `try/catch` qui rendait `null` : une
panne de base et un catalogue vide affichaient exactement la même chose — rien. C'est le mode
de panne que ce dépôt chasse depuis `ING-03`. Le repli reste (l'accueil ne doit pas tomber
avec la carte), mais il porte maintenant trois états DISTINCTS à l'écran : la panne se nomme,
le catalogue vide se dit, les quatre recettes s'affichent.

**Un gate qu'on lance pour SON lot mesure aussi l'état du dépôt, et il faut le lire.**
`npm audit --omit=dev` a rendu 2 avis — dont une **exécution de code à distance non
authentifiée** dans l'API d'optimisation d'images de Next — sur un lot qui ne touchait aucune
dépendance. Ce n'était pas mon défaut, mais il était devant moi. Ce qui a décidé l'arbitrage
n'est pas la gravité annoncée par l'avis : c'est d'avoir vérifié que la surface était
RÉELLEMENT ouverte ici (`/_next/image` est dans `isPublicPath`, donc servi sans session) au
lieu de le supposer. La convention dit qu'un défaut préexistant se signale sans se corriger ;
elle dit aussi de trancher avec l'option la plus prudente quand l'ambiguïté n'était pas
anticipée. Entre les deux, une RCE atteignable sans authentification sur un domaine public
n'attend pas le prochain tour — mais la décision se REMONTE, avec son alternative.

⚠️ Et le corollaire, celui qui coûte cher quand on l'oublie : **monter un plancher de version
sans l'inscrire dans le test qui garde les planchers, c'est le laisser redescendre au prochain
`npm install` distrait**. Les deux entrées (`next ≥ 15.5.24`, `sharp ≥ 0.35.4`) sont dans
`tests/dependances.test.ts` avec leur motif, et la discrimination est prouvée : porter le
plancher à 99.0.0 fait rougir le test, donc il voit bien la version installée.

**Un point d'attention se VÉRIFIE avant d'être écrit, même quand il vient du `CLAUDE.md`.**
J'ai écrit dans la PR #86 que « la préversion appliquera la migration à la base de production
dès le premier build », en recopiant fidèlement l'avertissement du `CLAUDE.md`. Vérifié
ensuite chez Vercel : **aucun déploiement n'a été créé pour ce push**, et la cause est dans
le dépôt — `web/vercel.json` porte `git.deploymentEnabled: { "claude/*": false }`. Les
branches `claude/*` ne produisent aucune préversion, donc leurs migrations n'atteignent la
production qu'au merge. L'avertissement était vrai quand il a été écrit, il ne l'est plus
pour la moitié des branches du dépôt — et je l'ai relayé sans le mesurer. Une phrase de
garde-fou vieillit comme n'importe quelle autre : celle-là avait cessé d'être vraie sans que
personne ne la relise.

⚠️ Corollaire de lecture d'un tableau de bord : un déploiement `CANCELED` n'est pas une panne
ici, c'est l'`ignoreCommand` qui a fait son travail sur un commit de docs seules. Les deux
derniers merges de `master` sont dans ce cas. Ce qui se vérifie après un merge qui touche du
CODE, c'est donc qu'un déploiement a été **créé ET construit**, pas seulement qu'il existe
une ligne récente.

## 14/09/2026 — le type de plat (`SEM-01`)

**Un classificateur se met au point sur un ÉCHANTILLON LU, pas sur une idée de ce que le
corpus contient.** Trois règles du module y sont nées, et aucune n'aurait été écrite sans
avoir regardé des titres réels :

1. « Porc **sauce** aigre douce » sortait en SAUCE. Un mot de famille doit OUVRIR le titre
   (article toléré) pour les familles dont le mot peut qualifier un accompagnement. ⚠️ Et la
   première version de cette règle comptait en CARACTÈRES : « Porc sauce » et « Ma sauce »
   commencent au même caractère, donc tout premier mot de quatre lettres devenait un article.
   C'est le test qui l'a imposé — la règle se compte en MOTS, avec une liste d'articles.
2. « **Flan** de thon provençal » sortait en DESSERT. Un mot qui sert des deux côtés de la
   cuisine française n'appartient à aucune famille : il devient ambigu et ce sont les
   ingrédients qui tranchent. Cinq autres sont arrivés là par le même chemin (verrine, toast,
   terrine, crumble, clafoutis).
3. « **Frites de cookie** » sortait en ACCOMPAGNEMENT. Un camp sucré franc l'emporte sur une
   famille salée nommée par le titre. ⚠️ L'inverse n'est PAS vrai : beurre, oeufs et une
   pointe de sel sont des faux amis dans une pâtisserie, donc un dessert nommé comme tel
   reste un dessert.

**`NFD` ne décompose pas les ligatures, et « bœuf » devenait « b uf ».** Sur un corpus
français où le boeuf est partout, le marqueur salé disparaissait de toutes ces recettes. Le
défaut est invisible à la relecture — la chaîne a l'air normalisée — et c'est un test
d'égalité sur `comparable()` qui l'a sorti. Tout ce qui normalise du français remplace `œ` et
`æ` AVANT `normalize("NFD")`.

⚠️ **Une mutation qui ne fait pas ce qu'on croit ne prouve rien.** Pour éprouver la règle des
mots ambigus, j'ai retiré « flan » de la liste des ambigus — et les 25 tests sont restés
verts. Normal : le mot ne matchait alors plus rien du tout, et les ingrédients tranchaient
quand même. La VRAIE mutation était de le remettre chez les desserts, et elle a bien rougi.
Une mutation se relit comme du code : « est-ce que je viens d'écrire la règle inverse, ou
juste de supprimer la règle ? »

**Une couverture n'est pas une exactitude, et les deux se publient séparément.** 91,4 % dit
combien de recettes reçoivent un type ; 54/56 dit combien le reçoivent JUSTE, et ce second
chiffre exige de lire des titres un par un. Publier le premier seul laisserait croire que
91,4 % sont bien classées. ⚠️ Et 56 est un petit échantillon : le chiffre ne se recopie pas
sans sa taille, sinon il devient « 96 % » dans six mois, sans marge et sans date.

---

## 2026-09-14 — Un compte DÉDUIT du travail effectué ne mesure pas l'état

Le premier build de production de SEM-01 a imprimé `[type] 9294 recette(s) (re)classée(s)
sur 10170 ; 10170 portent un type après cette passe.` Le premier nombre est juste, le
second annonce **100 % de couverture** — contre 91,4 % publiés dans le `CLAUDE.md`, le
`HANDOVER.md` et le `BACKLOG.md` de la même PR.

La cause tient en une ligne : la couverture était **déduite** (`total − écritures nulles`)
au lieu d'être **comptée**. Or une recette déjà à `null` qui reste `null` n'est pas écrite
— elle n'entre donc pas dans la liste d'écritures et échappe à la soustraction, tout en
étant précisément le cas qu'on voulait retrancher. Les 876 non classées étaient comptées
comme classées.

**Ce que ça apprend.** Un état se mesure sur l'état, jamais sur le journal du travail qui
l'a produit : la liste des écritures ne connaît que ce qui a CHANGÉ, elle est structurellement
aveugle à ce qui était déjà dans la valeur visée. Le remède n'est pas une soustraction plus
fine, c'est de supprimer la dérivation — un compteur incrémenté sur le verdict ne peut pas
se tromper de population.

⚠️ **Un chiffre faux dans un log a l'exacte apparence d'une mesure**, et celui-ci
contredisait la doc de sa propre PR sans que rien ne rougisse. Il n'a été vu que parce que
les logs du déploiement ont été lus après le merge — la vérification que le `CLAUDE.md` §6
impose pour de tout autres raisons. C'est la même famille que « no fake data », appliquée à
l'observabilité : un nombre qu'on ne sait pas justifier ne se publie pas, même dans un log.

⚠️ **Et corriger le calcul ne suffisait pas : il fallait aussi le rendre VISIBLE.** La passe
est idempotente, donc à partir du build suivant elle n'imprimait plus que « Rien à
reclasser. » — le chiffre corrigé n'aurait donc plus jamais été affiché, et la correction
serait restée inerte. La couverture se dit maintenant dans les deux branches.

Verrou : `tests/deploiement.test.ts`, tripwire de surface scopé à `classerCatalogue` (la
couverture vient d'un `verdict.type !== null`, et jamais d'une soustraction sur
`recettes.length`). Lecture sur la source DÉCOMMENTÉE — le commentaire qui décrit le motif
interdit ne doit pas satisfaire la garde qui le cherche. Discrimination prouvée par deux
mutations, une par assertion.

---

## 2026-09-14 — Une échelle à cinq niveaux se MESURE avant d'être promise

Marc a demandé des étoiles de difficulté et a choisi **cinq niveaux** contre ma
recommandation de trois. Ma réserve était sérieuse et elle était mesurable : la difficulté
se déduit de trois signaux (ingrédients, étapes, durée) qui sont **corrélés**, et une
moyenne de grandeurs corrélées fait une **cloche**. Avec des seuils « ronds »
(0,2 / 0,4 / 0,6 / 0,8), les étoiles 1 et 5 deviennent presque vides : la précision est
affichée, pas mesurée.

Ce qui a réglé le problème n'est pas un arbitrage mais une **mesure**. Les coupes de
l'échelle sont les **quintiles observés** du score composite sur le corpus. Résultat mesuré :
19,9 / 19,8 / 20,2 / 20,0 / 20,0 %. Les cinq niveaux existent vraiment — et le prix à payer
est que l'échelle est **relative au catalogue**, ce que l'écran doit dire : « 1 étoile »
signifie « parmi les plus simples du catalogue », pas « facile dans l'absolu ».

**La règle générale** : quand une échelle promet N niveaux, ce qui se teste n'est pas la
moyenne mais la **distribution**. Le test du corpus exige donc que chaque niveau dépasse
12 % — et la mutation qui le prouve est exactement le raccourci tentant : remplacer les
quintiles mesurés par des seuils ronds. Elle rougit.

⚠️ **Écarter une recommandation n'est pas l'ignorer.** Le risque que je signalais était
réel ; il ne justifiait pas trois niveaux, il justifiait de dériver les coupes du corpus
plutôt que de les choisir. Quand un arbitrage va contre une réserve technique, la bonne
réponse est souvent de **supprimer la cause** de la réserve, pas de re-plaider.

⚠️ **Ce qu'on mesure n'est pas ce que le mot promet.** « Difficulté » évoque la technique ;
les trois signaux disponibles mesurent l'**effort**. Une omelette roulée sort « très
simple ». Le corpus ne porte aucun signal de savoir-faire, donc les libellés parlent
d'exigence — nommer la limite vaut mieux que la laisser découvrir en cuisinant.

⚠️ **Un signal absent n'est pas un zéro.** Compter « durée inconnue » comme 0 minute ferait
passer une recette non renseignée pour la plus simple du catalogue : un manque déguisé en
mesure. Même règle pour le temps de la semaine — 224 recettes sur 10 188 n'ont aucune durée,
elles sortent du total et leurs titres sont nommés sous la ligne.

⚠️ **Un prix mémorisé doit savoir qu'il est périmé.** Le prix de la semaine est calculé une
fois par composition ; sans la `signature` des recettes, remplacer une recette laisserait à
l'écran le prix d'une semaine qui n'existe plus — avec l'exacte apparence d'une mesure.
C'est la même famille que le compte déduit du matin : ce qui décrit un état se recalcule
quand l'état change, sinon il ment sans rien casser.

⚠️ **Et c'est une garde écrite par un AUTRE lot qui a trouvé le vrai trou.** Mes propres
tests étaient tous verts ; le gate complet a rougi sur `tests/tempsRecette.test.ts`, la
garde « la copie catalogue → bibliothèque n'oublie aucune colonne » posée au lot CAT-C. La
nouvelle colonne n'était pas recopiée : une recette piochée au catalogue aurait affiché
« difficulté non estimée » jusqu'au déploiement suivant — un manque annoncé là où la note
existe. Quatrième fois que cette famille mord dans ce dépôt (`ville`, `adresse`, les listes
de colonnes) : **une colonne ajoutée se suit sur TOUS ses chemins de copie**, et c'est le
gate complet qui le prouve, jamais la suite qu'on vient d'écrire.

⚠️⚠️ **Deux sessions ont élargi le MÊME type dans la même heure, et git n'a rien vu.**
Pendant ce lot, une autre session a exporté `lireSemaine` pour la carte du hub (PR #89) et
posé des fixtures `RecetteSemaine`. J'ajoutais au même moment un champ REQUIS à ce type.
`git merge` a réussi sans un seul conflit — les deux diffs touchent des lignes différentes —
et c'est le `typecheck` qui a trouvé les six fixtures incomplètes. Un champ requis ajouté à
un type partagé est un changement de CONTRAT : il ne produit pas de conflit de texte, il
produit des erreurs ailleurs. Corollaire vécu dans le même passage : leur commit épinglait
un nouveau `hub-contract` (v1.3.0) et mon `node_modules` portait l'ancien — `npm install`
APRÈS un merge qui touche `package.json`, sinon le typecheck accuse le code pour une
install périmée.

⚠️ Et le champ reste **requis**, pas optionnel. L'optionnel aurait fait taire le typecheck
en une seconde — et c'est exactement ce qui laisserait une requête oublier la colonne en
silence, pour afficher « difficulté non estimée » sur des recettes parfaitement notées.

---

## 2026-09-14 — Deux pièces qui doivent s'accorder, et dont la divergence ne lève rien

`SEM-03` fait dialoguer un **prompt** (qui enseigne au modèle d'écrire
`[semaine 3 ← catalogue #482]`) et un **parseur** (qui transforme ce marqueur en bouton).
Le mode de panne n'est pas qu'une des deux soit fausse : c'est qu'elles **divergent**. Et
cette divergence est parfaitement silencieuse — l'assistant répond bien, le texte s'affiche,
et aucun bouton n'apparaît plus jamais. Pas d'erreur, pas de test rouge, rien.

Le verrou n'est donc pas un scan (« le prompt contient-il le mot marqueur ? ») mais un test
d'**accord comportemental** : on extrait le gabarit ÉCRIT dans le prompt, on y substitue une
place et un identifiant, et on le donne au vrai parseur. La mutation qui le prouve est celle
qui arriverait vraiment — quelqu'un « améliore » le format du prompt sans toucher au
parseur. Elle rougit.

**La règle générale** : quand deux pièces doivent s'accorder sur une FORME et qu'aucune ne
plante si l'accord se rompt, le test prend la forme chez l'une et la fait consommer par
l'autre. Écrire la forme en dur dans le test recréerait une troisième copie — donc une
troisième chance de diverger.

⚠️ **Un outil de lecture qui appelle une fonction qui ÉCRIT n'est plus un outil de lecture.**
`semaineCourante` fabrique la proposition quand elle manque (un `delete` suivi d'un
`insert`). Branchée sur `lire_semaine`, elle aurait fabriqué la semaine de Marc au détour
d'une question — et effacé la précédente. Une autre session avait rencontré exactement ça
quelques heures plus tôt pour la carte du hub, et sa note dans le code est ce qui m'a fait
regarder. La garde vaut dans les deux sens : l'outil doit appeler `lireSemaine`, et ne
**jamais** mentionner `semaineCourante`.

⚠️ **Une place qui se dit « 3 » et se stocke « 2 » a besoin d'un seul convertisseur.**
Marc dit « le troisième », la base compte de 0. Recopier `place - 1` à chaque site, c'est se
donner autant de chances de se tromper d'un cran — et se tromper d'un cran ici remplace
silencieusement une recette qu'il voulait garder. `positionEnBase` est le seul endroit, et
elle refuse tout ce qui n'est pas un entier de 1 à 4.

⚠️ **Un tirage DÉTERMINISTE rend son bouton de rejeu inerte.** La semaine est tirée sur la
graine `2026-W38` précisément pour ne pas bouger d'un affichage à l'autre. Un bouton
« propose-m'en quatre autres » qui rejouerait sur cette graine rendrait exactement les mêmes
quatre recettes : rien ne planterait, le bouton aurait juste l'air cassé. La graine doit
changer — et c'est ce que la garde vérifie, pas le fait qu'un tirage ait lieu.

---

## 2026-09-14 — Ma première mesure de ING-10 a rendu ZÉRO, et c'est la fixture qui était aveugle

Le ticket disait : le catalogue stocke une quantité PAR PORTION, les écrivains la
multiplient par `servings`, et l'arrondi appliqué AVANT la multiplication est multiplié lui
aussi. J'ai écrit le correctif, puis mesuré son effet sur le corpus. Résultat : **0 ligne
changée sur 84 696**.

Deux lectures possibles, et une seule est flatteuse : « le correctif ne sert à rien » ou
« ma mesure ne l'atteint pas ». La seconde était la bonne. Je mesurais avec
`recipe.servings` **du seed**, qui vaut 1 presque partout — or l'app ne s'en sert pas : elle
recalcule les portions depuis le texte source (`portionsRecette`, lot `CAT-A`). Et **à une
portion, les deux formules donnent le même résultat par construction** : `round(round(x))`
vaut `round(x)`. La fixture rendait le défaut mathématiquement invisible.

Re-mesuré avec les portions RÉELLES, celles que les écrivains emploient : **17 788 lignes
sur 73 542 chiffrées (24,2 %)** changent de valeur, pire écart absolu **0,20**. Et les
exemples sont exactement le symptôme de départ — « 49,98 g de farine de riz » → 50, « 1,98
pièces de blanc d'oeuf » → 2, « 4,02 tranches de jambon » → 4.

**La règle générale** : une mesure se fait avec les valeurs que la PRODUCTION emploie, pas
avec celles que la source porte. Ici les deux existent côte à côte dans la même table, sous
le même nom — `servings` — et l'une est celle que le code a cessé de croire il y a un mois.
C'est la variante « mesure » de `UNE-FIXTURE-QUI-SATURE-LA-CONTRAINTE-REND-LA-MESURE-AVEUGLE` :
le paramètre choisi annulait l'effet cherché, donc l'expérience ne pouvait rien dire.

⚠️ **Et un « 0 » est un résultat à EXPLIQUER, jamais un feu vert.** S'il avait été lu comme
« le correctif est inerte », le lot serait parti avec une conclusion fausse dans son message
de commit, et le défaut serait resté au backlog marqué « mesuré, sans effet ».

⚠️ **Deux entrées publiques valent mieux qu'un champ de plus.** Mon premier jet ajoutait
`qtyExacte` à `NormalizedQty` : le typecheck passait, et **17 assertions** existantes
tombaient, parce qu'elles comparent la forme complète du retour. Un champ interne poussé dans
un contrat public oblige tous ses lecteurs à le connaître. La bonne forme était d'extraire la
conversion NON arrondie dans une fonction privée, et d'en exposer deux entrées qui
n'appliquent pas la même politique d'arrondi — zéro test touché, et une seule table de
facteurs.

---

## 2026-09-14 — Le chantier n'existait pas : le bouton était déjà là, et mon entrée de backlog était fausse sur deux points

Marc a donné le feu vert pour les deux doublons de sa bibliothèque perso. Avant d'écrire une
ligne, j'ai re-mesuré ce que l'entrée du backlog affirmait — et **deux de ses trois
affirmations n'ont pas tenu**, alors que je l'avais écrite moi-même quelques jours plus tôt.

**« Deux recettes seulement sur quinze. »** La bibliothèque en compte **quatorze** : les ids
vont de 1 à 15 mais #10 n'existe plus. J'avais lu une PLAGE D'IDS comme un compte — le
chiffre d'à côté, déjà dans le log de build (« sur 14 recettes »), disait l'inverse depuis
des semaines. Recensement refait : #1 et #8 sont la SEULE paire en double des quatorze,
identiques au caractère près.

**« Le mécanisme existe déjà (`lib/menageCatalogue.ts`) et ne demanderait qu'une source
d'entrée différente. »** Faux, et c'est la partie utile. `retraitsCatalogue` groupe par titre
+ signature d'ingrédients, puis désigne l'exemplaire CONSERVÉ **par son URL** — un critère
choisi précisément pour être stable et indépendant des ids de production. Or ces deux lignes
partagent leur URL : l'outil ne peut ni les distinguer ni nommer celle qu'il garde. Un
mécanisme « réutilisable » se juge sur la CLÉ qu'il emploie, jamais sur ce qu'il fait en
gros.

**Et le chantier lui-même n'existait pas.** Le bouton « Supprimer » est sur la fiche depuis
toujours (`DeleteRecipeButton` → `deleteRecipe`), avec le refus honnête quand un batch
utilise la recette (clé étrangère `restrict`). Ce que j'allais proposer de construire — une
passe de suppression au déploiement — n'aurait fait que retirer à Marc le seul geste qui lui
restait sur SES données. Il a tranché pour le clic.

⚠️ **La règle, déjà écrite ici et re-payée** : vérifier qu'une tâche n'est pas DÉJÀ faite
avant de la planifier. La variante du jour est plus discrète que les précédentes — ce n'était
pas un fichier que j'allais réécrire, c'était une *capacité produit* qui existait, et que
mon entrée de backlog ne mentionnait pas.

⚠️ **Ce que je ne peux PAS mesurer se dit aussi.** Lequel des deux exemplaires garder dépend
de leur provenance (`lib/origine.ts`), et ni le serveur MCP ni le seed ne l'exposent : la
fiche l'affiche, moi non. Une recommandation qui aurait choisi « garde le plus petit id »
aurait eu l'air informée sans l'être.
