# ADR-0001 — Le stock de portions qui sort d'un batch

- **Date** : 2026-08-17
- **Statut** : accepté (décisions de Marc, session du 17/08/2026)

## Contexte

Le cycle codé s'arrêtait à `planifié → courses → cuisine → terminé`, et `setBatchStatus`
n'écrivait que le statut. Au moment précis où Marc finit de cuisiner, l'app cessait de savoir
quoi que ce soit : aucune des huit tables ne portait de notion de stock, de portions
restantes ni de congélateur.

Conséquence mesurable : **l'app servait le dimanche et ne servait plus du lundi au samedi**,
alors que le batch cooking est précisément ce qui vient après — des portions rangées qu'on
mange toute la semaine.

## Décision

Une table `portions`, une ligne par `(batch, recette, zone)` avec un compteur de portions
restantes. Trois choix tranchés par Marc :

1. **On compte en PORTIONS**, pas en contenants. Une portion = un repas. Le nombre existe
   déjà (`batch_recipes.portions`) : le rangement est pré-rempli, pas ressaisi.
2. **Frigo et congélateur sont DEUX zones distinctes.** Leurs durées de vie n'ont rien à
   voir, et c'est au moment où l'on empile les contenants qu'on sait où chacun va.
3. **Le passage à « terminé » demande où va quoi** (`terminerBatch`), il ne crée pas le stock
   en silence. `setBatchStatus` refuse désormais `termine` : un seul chemin.

## Pourquoi ces formes-là

- **Les deux clés étrangères sont en `set null`**, à l'inverse du reste du schéma qui est en
  `cascade`/`restrict`. Ce qu'il y a dans le congélateur existe pour de vrai : supprimer un
  batch (un artefact de PLANIFICATION) ou faire le ménage dans la bibliothèque ne doit pas
  effacer de la nourriture.
- **`titre` est une COPIE** prise au rangement, pas une jointure. L'écran de stock se lit
  sans dépendre d'une recette qui peut disparaître.
- **`range_le` est le geste de Marc**, pas `batches.created_at`. Un batch planifié il y a
  trois semaines et cuisiné aujourd'hui donne des portions d'aujourd'hui. L'écran dit
  « rangé », jamais « cuisiné » : c'est ce qu'on sait réellement.
- **Le décrément se fait en base** (`restantes - 1` en SQL), pas par lecture-puis-écriture :
  deux onglets ouverts retireraient sinon la même portion deux fois en n'en décomptant
  qu'une. La ligne est supprimée à zéro — « 0 portion de chili », ce n'est pas du chili.

## Idempotence : le garde est le STOCK, pas le statut

Refuser sur `status === "termine"` ne suffit pas. Trois chemins créeraient un deuxième jeu de
portions : le double envoi, le retour arrière du navigateur, et surtout
`terminé → cuisine → terminé` — qui remet le statut à zéro et rouvre la porte.

Le garde est donc « ce batch a-t-il DÉJÀ des portions ? ». Sans lui, l'app annoncerait à Marc
deux fois plus de repas qu'il n'en a — un mensonge silencieux, du genre qu'on ne remarque
qu'au moment d'ouvrir un congélateur vide.

## Les repères de conservation ne sont pas un verdict

`REPERE_JOURS` vaut 4 jours au frigo, 90 au congélo. Ce sont des **repères usuels**, et l'app
n'en tire aucune conclusion sanitaire : elle ne sait rien de ce qu'il y a dans la boîte ni de
la façon dont elle a été refroidie. Le vocabulaire à l'écran le reflète — « au-delà du repère
de N jours », jamais « c'est encore bon » ni « périmé ». Leur seul rôle est de faire remonter
en tête ce qui attend depuis longtemps.

## Ce qu'on n'a pas fait, et pourquoi

- **Pas de contenants.** Marc a écarté l'option : elle exige de saisir une répartition à
  chaque fin de batch, au moment où l'on a les mains sales.
- **Pas de dates de péremption calculées.** Ce serait de la donnée fabriquée : l'app ne
  connaît ni l'ingrédient critique ni la chaîne du froid. L'âge affiché, lui, est un fait.
- **Pas de rattrapage des batchs déjà terminés.** Ils n'ont pas de stock, et l'écran le DIT
  (« rangé avant que l'app ne suive les portions ») plutôt que d'afficher « 0 portion », qui
  affirmerait qu'il n'y a rien à manger.

## Conséquences

- Cinquième onglet, « Portions », entre Batchs et Catalogue : c'est l'écran de SEMAINE.
- L'accueil gagne « Portions au frais » en première tuile.
- Logique pure dans `lib/portions.ts`, verrouillée par `tests/portions.test.ts`
  (20 cas, discrimination prouvée par cinq mutations).
