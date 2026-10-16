import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Alias @/ identique à tsconfig : les modules testés (ex. lib/hubSummary) résolvent @/lib/db.
  // Le module db est paresseux (Proxy) : l'importer ne connecte jamais Neon, seul un query le ferait.
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  // Vite 8 (tiré par vitest 4.1+ et 5) transforme avec oxc, qui RESPECTE `"jsx": "preserve"` du tsconfig (réglage
  // voulu par Next) : les composants importés par les tests gardaient leur JSX brut et ne
  // s'analysaient plus. Pour les tests seulement, JSX compilé en runtime automatique (React 17+).
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Délais larges (#204) : une base PGlite (WebAssembly) met plus de 5 s à démarrer quand la machine est chargée
    // (CI partagée, plusieurs fichiers de test qui en créent une en parallèle). Mesuré le 16/10/2026 : sur UN seul cœur
    // (`taskset -c 0 npx vitest run`), `tests/sante.test.ts > 200 { ok: true }` dépassait 5 000 ms à chaque passe, alors
    // qu'il passe en 1 s sur une machine libre. Ce n'est pas un test qui boucle : c'est le démarrage de PGlite.
    testTimeout: 30_000,
    hookTimeout: 60_000,
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
