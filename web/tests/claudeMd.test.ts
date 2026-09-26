// Verrou : CLAUDE.md se charge à CHAQUE session, il doit rester court ; le détail vit dans
// docs/claude/ et docs/INDEX.md dit où est passé chaque ancien titre.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const RACINE = resolve(process.cwd(), "..");
const LIMITE_LIGNES = 60;

describe("CLAUDE.md court et indexé", () => {
  it(`ne dépasse pas ${LIMITE_LIGNES} lignes`, () => {
    const texte = readFileSync(resolve(RACINE, "CLAUDE.md"), "utf8");
    const lignes = texte.replace(/\n$/, "").split("\n").length;
    expect(lignes).toBeLessThanOrEqual(LIMITE_LIGNES);
  });

  it("docs/INDEX.md existe", () => {
    expect(existsSync(resolve(RACINE, "docs", "INDEX.md"))).toBe(true);
  });

  it("chaque fichier docs/claude/ cité par docs/INDEX.md existe", () => {
    const index = readFileSync(resolve(RACINE, "docs", "INDEX.md"), "utf8");
    const cibles = [...index.matchAll(/\]\((claude\/[^)]+)\)/g)].map((m) => String(m[1]));
    expect(cibles.length).toBeGreaterThan(0);
    for (const cible of cibles) {
      expect(existsSync(resolve(RACINE, "docs", cible)), cible).toBe(true);
    }
  });
});
