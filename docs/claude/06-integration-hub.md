# Intégration hub (ancien §7)

> Repris mot pour mot de l'ancien `CLAUDE.md` (lignes 510 à 554). Index : [`docs/INDEX.md`](../INDEX.md).

## 7. Intégration hub

- BatchChef publie `GET /api/hub/summary` conforme à `@mokarade/hub-contract` — **pinné sur
  le tag `v1.3.1`** depuis le 23/09/2026 (#110 : son `dist/` est commité, ce qu'exige npm 11
  sous Node 24 ; Dependabot ne le déplace plus, #116) — gardé par le jeton `x-hub-token`.
  Voir `lib/hubSummary.ts`.
  ⚠️ Re-pinner n'est pas optionnel pour consommer un champ neuf : Zod STRIPPE les clés
  inconnues, donc sur un pin antérieur `validateSummary` retire `dataAsOf`, `details` et
  `primary` **en silence** — et les tests passent en n'affirmant plus rien sur eux.
- ⚠️ **`HUB_TOKEN` sert dans LES DEUX SENS.** Entrant : le hub le présente pour lire le
  summary. **Sortant** : BatchChef le présente au hub sur `POST /api/acces`
  (`web/lib/accesHub.ts`) pour demander qui a le droit d'entrer. C'est le MÊME secret, et
  c'est lui qui IDENTIFIE BatchChef côté hub — aucun `appId` n'est envoyé dans le corps,
  sinon une app pourrait interroger les accès d'une autre.
- ⚠️ **`NEXT_PUBLIC_HUB_URL` n'est pas décoratif** : `web/lib/accesHub.ts` s'en sert comme
  base de `POST /api/acces`. La pointer ailleurs coupe l'accès de tout le monde sauf le
  propriétaire, **silencieusement** (échec fermé → `false`).
- **BatchChef garde son fournisseur Google**, contrairement à JobAI et CarAI. Ce qui vient du
  hub, c'est l'**autorisation**, pas l'authentification.
- **Période des coûts** : `total`. Le hub somme PAR période et ne fusionne jamais « cumulé »
  avec « ce mois-ci » — une app qui publierait `mois` se retrouverait seule dans sa colonne.
- ⚠️ **BatchChef publie `dataAsOf` et JAMAIS `expectedMaxAgeSec`, et c'est une décision.**
  Les quatre autres apps ont un moteur qui passe (un tick, un cron, un poll), donc un rythme
  attendu, donc un seuil au-delà duquel le hub déclare la donnée FIGÉE. Ici il n'y a pas de
  moteur : la donnée change quand **Marc cuisine**. Une semaine sans batch n'est pas une
  panne, c'est une semaine où il a mangé dehors — et n'importe quel seuil ferait crier
  « BatchChef est figée ». Sans seuil, le hub affiche l'âge et dit qu'il ne peut pas le juger
  (`age-connu-non-juge`, ADR-0003 de Hubperso). C'est la seule des cinq apps pour laquelle
  cet état est le BON, pas un pis-aller en attendant un re-pin. **Ne pas « compléter » le
  summary en ajoutant un seuil.**
- ⚠️ **Le hub LIT la semaine, il ne la fabrique pas.** `lib/hubSummary.ts` appelle
  `lireSemaine` (lecture seule), jamais `semaineCourante` — qui FABRIQUE la proposition
  manquante avec un `delete` + `insert`. Le hub interroge ce endpoint toutes les ~15 s tant
  qu'un onglet est ouvert, et son horloge toutes les 30 min sans personne devant : y brancher
  `semaineCourante` fabriquerait la semaine de Marc à son insu, et le
  `delete … where semaine <> …` effacerait la précédente. **Un GET n'écrit pas.**
- ⚠️ **Le numéro devant chaque recette de la semaine n'est pas décoratif.** Le contrat refuse
  deux lignes de même libellé dans une section, et `composeBatchchefSummary` valide À
  L'ÉMISSION : deux titres partageant leurs 37 premiers caractères (« Gratin de pommes de
  terre et de courgettes au parmesan » / « … au comté ») feraient jeter `validateSummary`,
  donc basculer TOUT le summary en `status: "error"` — la carte entière illisible à cause de
  deux titres qui se ressemblent. La `position` est unique par semaine
  (contrainte `week_picks_semaine_position`, en base), donc le préfixe l'est aussi. Et il
  informe : c'est le numéro auquel Marc parle (« remplace la deuxième »).

