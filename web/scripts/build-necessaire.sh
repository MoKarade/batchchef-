#!/usr/bin/env bash
# Décide si Vercel doit construire ce commit (`ignoreCommand` dans vercel.json).
#
# ⚠️ CONVENTION CONTRE-INTUITIVE DE VERCEL :
#     exit 0  → IGNORE le build (rien n'est déployé)
#     exit 1  → LANCE le build
# L'inverser ne produirait pas « un déploiement de trop » : ça les supprimerait TOUS, en
# silence, la CI restant verte pendant que la production se fige sur un commit ancien.
#
# D'où la règle : toute INCERTITUDE (historique tronqué, diff illisible, chemin inconnu) se
# résout en CONSTRUISANT. La liste des exemptions est FERMÉE ; celle de ce qui construit est
# ouverte. Se tromper dans un sens coûte un déploiement ; dans l'autre, ça fige la prod.
#
# Pourquoi ce script existe : le quota de déploiements gratuits est PARTAGÉ entre tous les
# projets Vercel de Marc. Le 2026-08-12 il a été épuisé (« more than 100 per day »), bloquant
# tous les projets pendant 24 h — alors qu'une bonne partie des commits ne touchait que de la
# documentation et des tests, c'est-à-dire rien de ce que le site sert.

set -u

# Vercel expose le SHA précédemment déployé ; hors Vercel, on compare au commit d'avant.
BASE="${VERCEL_GIT_PREVIOUS_SHA:-HEAD~1}"

DIFF=$(git diff --name-only "$BASE" HEAD 2>/dev/null) || exit 1 # historique illisible → build
[ -z "$DIFF" ] && exit 1                                        # diff vide → build

while IFS= read -r fichier; do
  [ -z "$fichier" ] && continue
  case "$fichier" in
    # Exemptions : rien de tout cela ne change ce que le site SERT.
    *.md) ;;              # documentation (CLAUDE.md, README…)
    web/tests/*) ;;       # tests (le build ne les exécute pas)
    .github/*) ;;         # workflows CI
    *) exit 1 ;;          # tout le reste → build
  esac
done <<< "$DIFF"

exit 0 # uniquement doc/tests/CI : la production sert déjà le bon code
