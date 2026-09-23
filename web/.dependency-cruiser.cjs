// Règles d'architecture de BatchChef (porte qualité de l'Atelier).
// But : que la structure décrite dans le CLAUDE.md (§2) reste VRAIE à mesure que le code grandit.
// Violations déjà présentes au 2026-09-22 : figées dans .dependency-cruiser-known-violations.json
// (cliquet : l'existant est toléré, toute NOUVELLE violation fait échouer la porte).
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "pas-de-cycle",
      comment: "Deux modules qui s'importent mutuellement : l'ordre de chargement devient fragile.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "pas-d-import-introuvable",
      comment: "Un import qui ne se résout vers rien casse au build ou, pire, à l'exécution.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true, dependencyTypesNot: ["type-only"] },
    },
    {
      name: "prod-sans-dependance-de-dev",
      comment: "Le code servi ne doit pas dépendre d'un paquet de développement (absent en production).",
      severity: "error",
      from: { path: "^(app|lib|components)/", pathNot: "\\.test\\.ts$" },
      to: { dependencyTypes: ["npm-dev"], dependencyTypesNot: ["type-only"] },
    },
    {
      name: "lib-n-importe-pas-l-interface",
      comment: "lib/ est la logique ; elle ne doit connaître ni les routes (app/) ni les composants.",
      severity: "error",
      from: { path: "^lib/" },
      to: { path: "^(app|components)/" },
    },
    {
      name: "composants-sans-base-de-donnees",
      comment: "Un composant d'affichage ne parle pas directement à la base : il passe par lib/ (actions, requêtes).",
      severity: "error",
      from: { path: "^components/" },
      to: { path: "^lib/db/" },
    },
    {
      name: "tests-hors-du-code-servi",
      comment: "Le code servi n'importe jamais un test.",
      severity: "error",
      from: { path: "^(app|lib|components)/" },
      to: { path: "^tests/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^(\\.next|node_modules|coverage|reports|drizzle)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node", "default", "types"] },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
