// eslint.config.mjs — flat config (ESLint 9). `eslint-config-next` n'exporte pas encore de
// format flat natif : on le charge via FlatCompat, approche documentée par Next.js pour les
// projets flat-config. Étend le typecheck (déjà strict) avec les règles React/Next/a11y et
// les hooks (deps manquantes, etc. — cf. le bug de state périmé du sitrep).

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "node_modules/**", "drizzle/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
