import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Alias @/ identique à tsconfig : les modules testés (ex. lib/hubSummary) résolvent @/lib/db.
  // Le module db est paresseux (Proxy) : l'importer ne connecte jamais Neon, seul un query le ferait.
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
