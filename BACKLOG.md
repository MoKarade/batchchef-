# BACKLOG — BatchChef

> Convention de l'écosystème (FinanceAI, DriveAI, JobAI) : **chaque tâche porte une case**
> `- [ ]`. Une note sans travail à faire n'est pas une tâche — elle va dans un ADR ou dans
> `docs/LESSONS.md`. Un item fini se coche **au merge**, dans la même PR que le code.
>
> ⚠️ Un item peut être **périmé** : vérifier l'état réel avant de coder.

## En cours / décidé, pas encore livré

Demandes de Marc du 17/08 (soir), dans l'ordre où il les a posées.

- [ ] **`ING-01` — Ne plus faire acheter sel, poivre & compagnie.**
  ⚠️ **PAS une liste que Marc tient à jour** : il vient de refuser le garde-manger
  déclaratif. Ça doit être AUTOMATIQUE — une catégorie d'ingrédients de fond (sel, poivre,
  eau, épices de base) reconnue au moment de l'agrégation, jamais un écran de gestion.
  Reste à trancher : la liste vit-elle en dur dans `lib/` (prévisible, testable) ou est-elle
  décidée par le LLM au parse (souple, mais variable d'une recette à l'autre) ?
- [ ] **`ING-02` — Quantités plus précises, moins d'erreurs.**
  ⚠️ Diagnostiquer AVANT de coder : mesurer sur de vraies recettes OÙ l'erreur naît
  (extraction LLM ? conversion d'unités ? mise à l'échelle ? agrégation ?). Une plainte sur
  ce qu'on VOIT ne désigne presque jamais la couche à changer — leçon déjà payée deux fois
  chez JobAI.
- [ ] **`BOT-01` — Chatbot Claude sur la base.** Trois usages demandés : quelles recettes
  avec les ingrédients que j'ai (même incomplets), trouver des équivalents d'ingrédients,
  créer une recette en s'appuyant sur toute la base.
  **Décision Marc : Claude interroge la base LUI-MÊME par outils** (plusieurs allers-retours),
  pas un pré-filtre SQL suivi d'un seul appel. Il peut donc creuser au lieu d'être limité par
  un filtre écrit d'avance.
  ⚠️ 10 188 recettes : aucun modèle ne les reçoit d'un coup. Et le coût par question est
  supérieur à un appel unique — à mesurer et à publier dans `llm_usage` comme le reste.

## Écarté volontairement

- [x] ~~Recherche dans la bibliothèque perso~~ — **écarté par Marc le 17/08**. Le catalogue
  (10 188 recettes, ouvert rarement) a une recherche ; la bibliothèque perso, ouverte
  souvent, n'en a pas. Constat exact, mais Marc juge le volume actuel trop faible pour que
  ça vaille le travail. À rouvrir si la bibliothèque grossit.

## Idées non arbitrées

Rien n'est engagé ici — à proposer à Marc avant de coder.

- [ ] Le stock ne sait pas ce qui a été mangé, seulement ce qu'il reste. Un historique
  permettrait « tu manges du chili trois fois par semaine », mais c'est de la mesure sans
  usage tant que personne ne l'a demandée.
- [ ] Le budget d'épicerie n'est jamais confronté au réel (pas de reçus — décision
  assumée dans `CLAUDE.md`). Aucun moyen de savoir si l'estimation est bonne à ±10 % ou à ×2.

## Retiré à la demande de Marc (17/08, soir)

- [x] ~~**Stock de portions** (frigo/congélo, onglet Portions, rangement en fin de batch)~~ —
  livré le matin, retiré le soir : Marc n'en veut pas. Tables `portions` et `pantry`
  supprimées (migration `0008`), ADR-0001 retiré.
- [x] ~~**`GM-01` — Garde-manger déclaratif**~~ — même décision. Le BESOIN reste (« je veux
  plus que ça me demande d'acheter du sel ou du poivre ») mais il doit être **automatique**,
  pas une liste à tenir : c'est `ING-01`.

## Fait

- [x] ~~**`GM-01` — Garde-manger.**~~ Bouton « Placard » sur chaque article restant d'une liste,
  section « à vérifier au placard » (repliée, cochable, JAMAIS supprimée), écran
  `/garde-manger` pour défaire. Table vide au départ, comme décidé. 17/08/2026.
- [x] **`ACC-01` — Compteur d'accueil.** Jointure sur `batches` + exclusion des batchs
  terminés : le chiffre ne se dégrade plus avec le temps. 17/08/2026.
- [x] **Stock de portions** — le cycle se referme après « terminé ». 17/08/2026,
  `docs/adr/0001-portions-en-stock.md`.
- [x] **Documents vivants** (`HANDOVER.md`, ce fichier, `docs/LESSONS.md`, `docs/adr/`) —
  le dépôt n'en avait aucun. 17/08/2026.
- [x] **Verrou du socle visuel** (`web/tests/theme.test.ts`) après la régression texte blanc
  sur blanc. 14/08/2026, PR #55.
- [x] **Web Analytics** — PR #44, conflit résolu et mergée. 17/08/2026.
