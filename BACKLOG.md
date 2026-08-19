# BACKLOG — BatchChef

> Convention de l'écosystème (FinanceAI, DriveAI, JobAI) : **chaque tâche porte une case**
> `- [ ]`. Une note sans travail à faire n'est pas une tâche — elle va dans un ADR ou dans
> `docs/LESSONS.md`. Un item fini se coche **au merge**, dans la même PR que le code.
>
> ⚠️ Un item peut être **périmé** : vérifier l'état réel avant de coder.

## En cours / décidé, pas encore livré

- [x] ~~**`MCP-02` — poser `MCP_TOKEN` dans Vercel.**~~ **Fait le 19/08.** Marc a branché le
  connecteur claude.ai ; les outils rendent ses vraies données depuis la base de production.

- [x] ~~**`ING-03` — les noms d'ingrédients du catalogue portent des morceaux de quantité.**~~
  **Livré le 19/08.** Mesuré sur le corpus entier avant de coder : **2 371 entrées abîmées
  sur 15 389**, trois formes (« À Soupe De … », « Ousses … », « S De … »), toutes issues de
  la même faute de l'app V3 — une extraction d'unité sans frontière de mot (`g` reconnu DANS
  « gousses », `cuillères` retiré alors que l'unité est `cuillères à soupe`, `pincée` retiré
  au singulier). Réparation par retrait de préfixe, appliquée au catalogue, à la bibliothèque
  ET aux listes d'épicerie existantes, en automatique au déploiement. **965 réparations
  rejoignent un ingrédient déjà présent** : autant de lignes qui cessent de se dédoubler.

## Livré (19/08)

- [x] **`MCP-01` — serveur MCP distant** (`POST /api/mcp`), lecture ET écriture (décisions de
  Marc du 19/08). Sept outils, JSON-RPC 2.0 écrit à la main, SDK officiel en devDependency
  comme tripwire de versions. Vérifié par onze sondes contre un serveur réellement démarré,
  pas seulement compilé.

## Écarté volontairement

- [x] ~~Recherche dans la bibliothèque perso~~ — **écarté par Marc le 17/08**. Le catalogue
  (10 188 recettes, ouvert rarement) a une recherche ; la bibliothèque perso, ouverte
  souvent, n'en a pas. Constat exact, mais Marc juge le volume actuel trop faible pour que
  ça vaille le travail. À rouvrir si la bibliothèque grossit.

## Idées non arbitrées

Rien n'est engagé ici — à proposer à Marc avant de coder.

- [ ] **Unité INCONNUE → compter des pièces plutôt que « au goût » ?** Envisagé pendant
  `ING-02` puis **écarté volontairement**. Ça sauverait le compte (« 3 verres » → 3 unités
  au lieu de rien), mais ça fabriquerait une nouvelle classe d'erreur : « 3 unités de lait »
  a l'air juste et ne l'est pas. Un aveu d'ignorance vaut mieux qu'un nombre plausible et
  faux — même arbitrage que « un 0 crédible est pire qu'un — honnête ». À rouvrir seulement
  si une mesure montre que les unités inconnues sont fréquentes ET majoritairement des pièces.

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

- [x] **`BOT-02` — Cartes de recettes cliquables dans le chat.** Une recette citée par
  l'assistant devient une pastille ; elle ouvre la fiche (ingrédients + préparation)
  PAR-DESSUS la conversation, qui n'est jamais détruite. Demande de Marc, 19/08/2026.
- [x] **`BOT-01` — Assistant Claude sur la base.** Onglet `/assistant`. Claude fouille via
  trois outils (recherche par ingrédients avec couverts/manquants calculés en SQL, lecture
  d'une recette, fréquence des ingrédients). Bornes : 8 allers-retours max — la borne
  atteinte est DITE —, historique tronqué sur frontière paire, coût compté par tour.
  19/08/2026.
- [x] **`ING-01` — Sel, poivre et eau hors de la liste d'épicerie.** Automatique, liste
  fermée dans le code, appariement mot à mot (« poivron » survit), écart DIT à l'écran.
  19/08/2026.
- [x] **`ING-02` — Quantités : 58 % → 28 % de perte.** Mesuré avant/après sur 50 unités
  réelles. La cause était l'asymétrie FR/EN de la table d'unités, pas la couche que je
  soupçonnais. Les 28 % restants sont des contenants sans taille fixe — pertes légitimes.
  19/08/2026.
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
