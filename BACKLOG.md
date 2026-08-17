# BACKLOG — BatchChef

> Convention de l'écosystème (FinanceAI, DriveAI, JobAI) : **chaque tâche porte une case**
> `- [ ]`. Une note sans travail à faire n'est pas une tâche — elle va dans un ADR ou dans
> `docs/LESSONS.md`. Un item fini se coche **au merge**, dans la même PR que le code.
>
> ⚠️ Un item peut être **périmé** : vérifier l'état réel avant de coder.

## En cours / décidé, pas encore livré

Rien. Les trois chantiers arbitrés par Marc le 17/08 sont livrés (voir « Fait »).

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

## Fait

- [x] **`GM-01` — Garde-manger.** Bouton « Placard » sur chaque article restant d'une liste,
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
