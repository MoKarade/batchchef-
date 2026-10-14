# Workflow git (ancien §3)

> Repris mot pour mot de l'ancien `CLAUDE.md` (lignes 381 à 397). Index : [`docs/INDEX.md`](../INDEX.md).

## 3. Workflow git

Branche `claude/<slug>` → commits en français → push → PR. **Depuis le 23/09, la fusion est
AUTOMATIQUE** (`.github/workflows/armement-auto-merge.yml` + `auto-merge.yml`, kit de l'Atelier, copies
exactes listées dans `COPIES.md`) : toute PR non brouillon — Dependabot compris — part en squash dès que
les contrôles obligatoires de `master` sont verts, SAUF si elle touche un chemin sensible
(`.github/auto-merge.json`, `modeles/auto-merge/chemins-interdits-base.json`) : migrations et schéma
(`web/drizzle/**`, `web/lib/db/**`) = Marc ; le reste = attestation de pole-securite.
Une PR en **brouillon** n'est jamais fusionnée : c'est le seul frein. Corollaire : tout ce qui
doit partir avec le lot (doc, tests, leçons) est committé AVANT d'ouvrir la PR hors brouillon
— une PR légère peut partir en quelques minutes, et une PR mergée ne se rattrape pas.

> **Constat au 14/10/2026** (fichiers lus sur `master`, `e0a22e7`) : le mécanisme décrit
> ci-dessus est bien celui qui est en place — `armement-auto-merge.yml` (arme l'auto-fusion
> native de GitHub selon `peutArmer`) et `auto-merge.yml` (décision et fusion par
> `modeles/auto-merge/fusionner.mjs`, déclenché par la fin de la CI, les statuts, les checks,
> la sortie de brouillon, un cron toutes les 6 h et un lancement manuel), copies du kit de
> l'Atelier en version **1.16.0** (`COPIES.md`, #161). Contrôles requis : les quatre jobs de
> `ci.yml` listés dans `.github/auto-merge.json` ; frein de 6 fusions par heure ; attestation
> de pole-securite par l'App `atelier-securite-marc[bot]` (#134). **Ce dépôt n'a pas de
> fichier `CODEOWNERS`** (contrairement à ce que décrivent CarAI, DriveAI et MemoryAI dans
> leur section « Fusion native (P1, 2026-10-01) ») : ici, ce sont `chemins_interdits` et
> `chemins_label_validation` qui retiennent les chemins sensibles.
>
> ⚠️ À trancher par Marc (14/10) : trois règles écrites ne disent pas la même chose.
> (1) Ce fichier : « une PR en brouillon n'est jamais fusionnée : c'est le seul frein ».
> (2) `atelier/CLAUDE.md`, pour les apps `"fusion_auto": true` (BatchChef l'est dans
> `apps.json`) : revue agents AVANT d'ouvrir la PR, **jamais en brouillon**, et « ne jamais
> fusionner à la main ». (3) `claude-config/CLAUDE.md` : « je fusionne moi-même une PR dès
> que sa CI est verte et qu'elle n'est plus en brouillon ». Aucune n'est modifiée ici.

⚠️ Après un squash-merge, GitHub supprime la branche : repartir de `master`
(`git fetch origin master && git checkout -B <branche> origin/master`) avant la tâche
suivante, jamais empiler sur l'historique déjà mergé.

- ⚠️ **`git fetch origin master` AVANT de committer.** Plusieurs sessions travaillent en
  parallèle sur l'écosystème ; le 20/08/2026, deux d'entre elles ont produit la même
  correction, mot pour mot, dans la même heure.

