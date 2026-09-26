# Workflow git (ancien §3)

> Repris mot pour mot de l'ancien `CLAUDE.md` (lignes 381 à 397). Index : [`docs/INDEX.md`](../INDEX.md).

## 3. Workflow git

Branche `claude/<slug>` → commits en français → push → PR. **Depuis le 23/09, la fusion est
AUTOMATIQUE** (`.github/workflows/fusion-auto.yml`, #105/#110) : toute PR non brouillon —
Dependabot compris — part en squash dès que les contrôles obligatoires de `master` sont verts.
Une PR en **brouillon** n'est jamais fusionnée : c'est le seul frein. Corollaire : tout ce qui
doit partir avec le lot (doc, tests, leçons) est committé AVANT d'ouvrir la PR hors brouillon
— une PR légère peut partir en quelques minutes, et une PR mergée ne se rattrape pas.

⚠️ Après un squash-merge, GitHub supprime la branche : repartir de `master`
(`git fetch origin master && git checkout -B <branche> origin/master`) avant la tâche
suivante, jamais empiler sur l'historique déjà mergé.

- ⚠️ **`git fetch origin master` AVANT de committer.** Plusieurs sessions travaillent en
  parallèle sur l'écosystème ; le 20/08/2026, deux d'entre elles ont produit la même
  correction, mot pour mot, dans la même heure.

