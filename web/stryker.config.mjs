// Tests de mutation (porte qualité de l'Atelier).
// Stryker modifie volontairement le code (un `<` devient `<=`, un `0.15` devient `0`…) et relance
// les tests : si aucun test ne casse, le « mutant » survit — la ligne est exécutée mais rien ne
// vérifie vraiment son résultat. Le score = % de mutants tués. C'est ce qui distingue un test qui
// vérifie d'un test qui se contente de passer.
// Lent : lancé chaque semaine en CI et à la demande (`npm run mutation`), pas à chaque commit.
// Lu par les tests trop lents sous instrumentation pour se mettre de côté (describe.skipIf) ;
// posé ici pour être hérité par les processus de test que Stryker lance.
process.env.PORTE_MUTATION = "1";

const config = {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: { configFile: "vitest.mutation.config.ts" },
  // La logique pure vit dans lib/. lib/db/ (connexion Neon) n'est pas testable sans base.
  mutate: ["lib/**/*.ts", "!lib/db/**"],
  coverageAnalysis: "perTest",
  incremental: true,
  incrementalFile: "reports/stryker-incremental.json",
  reporters: ["json", "html", "clear-text", "progress"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  htmlReporter: { fileName: "reports/mutation/index.html" },
  thresholds: { high: 80, low: 60, break: null },
  concurrency: 12,
  timeoutMS: 20000,
  tempDirName: ".stryker-tmp",
};

export default config;
