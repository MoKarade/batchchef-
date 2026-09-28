# Conventions de code, structure web/, direction visuelle (ancien §2)

> Repris mot pour mot de l'ancien `CLAUDE.md` (lignes 318 à 380). Index : [`docs/INDEX.md`](../INDEX.md).

## 2. Conventions de code

- Réponses, commits et docs **en français** (`feat:`, `fix:`, `docs:`…).
- TypeScript strict, pas de `any` silencieux. Erreurs honnêtes, jamais avalées.
- Pas d'emoji dans l'UI ni les docs (sauf demande explicite).

### Structure `web/`

| Chemin | Rôle |
|---|---|
| `app/` | routes (recettes, batchs, courses, catalogue, `/api/hub/summary`, `/api/mcp`) |
| `lib/actions.ts` | Server Actions (import, batch, liste, statut, catalogue) |
| `lib/aggregate.ts` | agrégation liste d'épicerie, mise à l'échelle, filet de prix (purs) |
| `lib/ingredientsDeFond.ts` | sel/poivre/eau écartés de la liste — automatique, mot à mot, et DIT à l'écran (PUR, testé) |
| `lib/assistant/` | `protocole.ts` = bornes, troncature, classement, balisage (PUR, testé) · `outils.ts` = ce que Claude peut interroger · `boucle.ts` = les allers-retours |
| `lib/mcp/` | `protocole.ts` = JSON-RPC + négociation de version (PUR, testé) · `declarations.ts` = les 7 outils ANNONCÉS (données pures, testables sans next-auth) · `outils.ts` = ce qui les EXÉCUTE. La correspondance des deux derniers est verrouillée dans les DEUX sens |
| `lib/llm/` | parse de recette (page web **et** vidéo) + estimation de coûts (Zod, honnête) |
| `lib/video/` | `frames.ts` = sondage/empreintes/budget (PUR, testé) · `capture.ts` = extraction `<video>`+`<canvas>` en 2 passes (repérage 32×32 puis extraction 768 px) **dans le navigateur** (la vidéo ne monte jamais au serveur) |
| `lib/partage.ts` + `public/sw.js` | cible de partage Android (PWA). Le service worker intercepte le POST **côté navigateur** : la vidéo partagée ne transite pas par le serveur |
| `lib/db/` | schéma Drizzle + connexion Neon paresseuse |
| `lib/hubSummary.ts` | résumé conforme `@mokarade/hub-contract` (widget hub perso) |
| `data/batchchef.seed.db` | base seed du catalogue (10 188 recettes) |

### Direction visuelle (décision de Marc, 13/08/2026)

**Identité d'app de cuisine, pas de tableau de bord.** Les deux écrans les plus utilisés —
la liste d'épicerie et une recette — se lisent DEBOUT, une main occupée, parfois sous les
néons d'un supermarché.

- **Les couleurs vivent dans `app/globals.css`, en variables, et NULLE PART ailleurs.** Le
  vocabulaire est `.carte` / `.bouton` / `.champ` / `.doux` / `.succes` / `.alerte` /
  `.erreur` (+ `.sur-accent`, `.texte-succes`, `.texte-erreur` pour du texte sans fond).
  Avant, 288 chaînes de classes recopiées réinventaient bordures et gris d'un écran à
  l'autre : c'est ce qui faisait dériver l'ensemble à chaque page ajoutée.
  ⚠️ **Une couleur figée est INVISIBLE à la relecture** : elle est parfaitement lisible dans
  le thème pour lequel on l'a écrite. Vécu le 14/08/2026 — ma passe de refonte a remplacé
  les variantes `dark:bg-stone-900` par des jetons en LAISSANT le `bg-white` en dur qu'elles
  corrigeaient : 21 endroits, fond blanc figé sous un texte clair hérité en thème sombre,
  zéro test rouge, zéro erreur. C'est Marc qui l'a vu sur son téléphone. Un remplacement
  ordonné qui supprime le correctif AVANT l'original laisse toujours ce trou-là.
  *Verrou* : `web/tests/theme.test.ts` — il refuse toute classe de palette Tailwind dans
  `app/`/`components/`/`lib/`, toute variante appliquée au vocabulaire maison
  (`dark:texte-erreur` ne génère rien) ou vide (`dark:` seul), tout `var(--jeton)` inexistant,
  et toute couleur définie en clair mais oubliée en sombre. Portée = `git ls-files` **+** le
  neuf non ignoré (sinon le garde arrive un commit trop tard) ; l'unique exception est
  NOMMÉE classe par classe (la case posée sur une photo, dont le contraste se joue contre
  l'image). Discrimination prouvée par quatre mutations, une par test.
  ⚠️ **Le CSS servi n'est PAS le bon endroit où vérifier.** Tailwind v4 balaie tout le dépôt,
  commentaires et Markdown compris : la prose qui raconte ce bug génère des règles
  `.bg-white` / `.dark\:bg-stone-900` que plus aucun balisage n'utilise. Inerte, mais ça
  ressemble à une rechute. Ce qui tranche est le **HTML servi** (la classe rendue), pas la
  présence d'une règle dans la feuille.
- **L'accent (`--accent`) ne sert QU'À l'action principale.** Ailleurs, il ment sur ce qui
  est cliquable.
- **Navigation en bas sur téléphone** (`components/Navigation.tsx`), en haut à partir de
  `sm`. `estOngletActif` est pure et testée — un onglet allume sa SECTION, `/` est traité à
  part. ⚠️ `env(safe-area-inset-bottom)` + `viewportFit: "cover"` : sans eux la barre passe
  sous la barre de gestes d'Android.
- **Cibles tactiles ≥ 44 px, champs à 16 px** (en dessous, iOS zoome tout seul).
- ⚠️ **Pas de police téléchargée.** `next/font/google` va chercher les fichiers AU BUILD :
  dépendance réseau au déploiement, et tout build hors ligne casse. Les piles système
  donnent déjà le contraste serif (titres) / sans (texte).

