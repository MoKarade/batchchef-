import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

// Configuration réservée aux tests de mutation (stryker.config.mjs).
//
// Exclus : les tests « gardes de structure » qui lisent le TEXTE source d'un fichier de lib/,
// app/ ou components/ (ex. « l'outil appelle lireSemaine, jamais semaineCourante »). Stryker
// réécrit ce texte en l'instrumentant : ils échoueraient sans qu'aucun mutant n'y soit pour
// rien. Ils restent actifs dans `npm test` et dans la CI — ils ne comptent juste pas dans le
// score de mutation, qui juge les tests de COMPORTEMENT.
// Liste à tenir à jour : `grep -l '"lib/.*\.ts"' tests/*.ts` (même motif pour app/ et components/).
const GARDES_DE_STRUCTURE = [
  "tests/deploiement.test.ts",
  "tests/imageRecette.test.ts",
  "tests/partage.test.ts",
  "tests/rechercheNormalisee.test.ts",
  "tests/semaineAssistant.test.ts",
  "tests/semainePrix.test.ts",
  "tests/tempsRecette.test.ts",
  "tests/theme.test.ts",
];

// PORTE_MUTATION=1 : un test trop lent sous instrumentation peut se mettre de côté
// (describe.skipIf — cf. « le CORPUS RÉEL » dans tests/semaine.test.ts).
export default mergeConfig(
  base,
  defineConfig({
    test: {
      exclude: [...configDefaults.exclude, ...GARDES_DE_STRUCTURE],
      env: { PORTE_MUTATION: "1" },
      testTimeout: 60_000,
    },
  }),
);
