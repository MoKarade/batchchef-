// eslint.config.mjs — flat config natif. eslint-config-next 16 exporte enfin ses configurations
// au format flat (`eslint-config-next/core-web-vitals`, `/typescript`) : plus besoin de FlatCompat
// ni de @eslint/eslintrc (retiré des dépendances). Toutes les règles d'avant sont conservées —
// React/Next/a11y et les hooks (deps manquantes, etc. — cf. le bug de state périmé du sitrep) —
// PLUS 15 règles du React Compiler apportées par eslint-plugin-react-hooks 7 (purity, refs,
// set-state-in-effect…). Mesuré le 23/09/2026 : 0 erreur, 0 avertissement, avant comme après.
// eslint reste en 9 : eslint-plugin-react, embarqué ici, plante sur eslint 10 (cf. dependabot.yml).
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  // coverage/, reports/, .stryker-tmp/ : sorties générées par les portes qualité (Atelier).
  { ignores: [".next/**", "node_modules/**", "drizzle/**", "next-env.d.ts", "coverage/**", "reports/**", ".stryker-tmp/**"] },
  ...nextVitals,
  ...nextTs,
];

export default config;
