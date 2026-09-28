# Commandes utiles et vérifications avant commit (anciens §4-5)

> Repris mot pour mot de l'ancien `CLAUDE.md` (lignes 398 à 443). Index : [`docs/INDEX.md`](../INDEX.md).

## 4. Commandes utiles

```bash
cd web
npm run dev        # http://localhost:3000
npm run test       # vitest
npm run typecheck  # tsc --noEmit
npm run build      # build de production
npm run lint       # eslint
npm run portes     # portes qualité de l'Atelier (cliquet, web/qualite/seuils.json)
npm run architecture  # règles d'architecture (dependency-cruiser)
npm run code-mort  # knip
npm run mutation   # Stryker
```

## 5. Vérifications avant commit

```bash
cd web && npm run typecheck && npm run test && npm run build
```

Et, après toute modification de dépendances : `npm audit --omit=dev` doit rendre **0**.
Les quelques avis `moderate` restants sont **dev-only** (chaîne `esbuild` → `drizzle-kit`,
serveur de développement) : ils ne touchent pas la production et `npm audit fix --force`
proposerait de rétrograder Next en 9.x, ce qui casserait l'app.

**Portes qualité (Atelier)** : `cd web && npm run portes` — lint, couverture, code mort, règles
d'architecture, comparés aux seuils de `web/qualite/seuils.json`. Principe du cliquet : l'existant
est toléré, aucun chiffre ne recule ; `npm run portes:maj` resserre un seuil amélioré (à committer).
Mutation : `npm run mutation` (≈ 4 min), hebdomadaire en CI. Détail : `web/qualite/portes.mjs`.

⚠️ La branche par défaut du dépôt est **`master`**, pas `main`. Repartir de `master`.

⚠️ **Et `main` n'était PAS « une vieille branche abandonnée qui a divergé » — c'est ce que
disait cette ligne, et c'était faux.** Les deux branches n'ont **aucun ancêtre commun** :
`git merge-base main master` ne rend rien. Ce sont deux histoires sans rapport. `main` portait
**75 commits absents de `master`**, dont `frontend/components/features/WeekPlannerPage.tsx`
— un planificateur de repas hebdomadaire de type Trello qui n'existe **nulle part** sur le
tronc actuel. C'est le BatchChef d'AVANT la reprise sous `web/`.

Cette description erronée a failli justifier une suppression pure et simple le 21/08/2026 ;
seule une vérification faite *avant* d'agir l'a empêchée. L'historique est conservé sur
**`archive/pre-web-2026-04-24`** (pointe `6638f8b`). La leçon générale : une phrase de doc qui
qualifie quelque chose de « mort » autorise implicitement à le détruire — elle doit être
vérifiée avant d'être écrite, pas après.

