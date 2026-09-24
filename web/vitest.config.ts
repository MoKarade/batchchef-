import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Alias @/ identique à tsconfig : les modules testés (ex. lib/hubSummary) résolvent @/lib/db.
  // Le module db est paresseux (Proxy) : l'importer ne connecte jamais Neon, seul un query le ferait.
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  // vitest 5 (Vite 8) transforme avec oxc, qui RESPECTE `"jsx": "preserve"` du tsconfig (réglage
  // voulu par Next) : les composants importés par les tests gardaient leur JSX brut et ne
  // s'analysaient plus. Pour les tests seulement, JSX compilé en runtime automatique (React 17+).
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Couverture (porte qualité de l'Atelier) : calculée seulement avec --coverage (npm run portes).
    coverage: {
      provider: "v8",
      include: ["app/**/*.{ts,tsx}", "lib/**/*.ts", "components/**/*.tsx"],
      exclude: ["**/*.d.ts"],
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
