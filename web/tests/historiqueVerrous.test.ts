// HIST-01 — verrous sur le SOURCE et le SQL de migration (C2, C4, C9, C11).
// Une migration qui toucherait une table existante, ou une écriture sortie du lot atomique,
// ne se verrait ni au build ni dans l'écran : ces tests la font tomber.

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = resolve(process.cwd());
const lire = (chemin: string): string => readFileSync(join(RACINE, chemin), "utf8");

/** La migration qui crée `meal_history` (numéro fixé par drizzle-kit, retrouvé par contenu). */
function migrationHistorique(): { nom: string; sql: string } {
  const nom = readdirSync(join(RACINE, "drizzle")).find(
    (f) => f.endsWith(".sql") && /CREATE TABLE "meal_history"/.test(lire(`drizzle/${f}`)),
  );
  if (!nom) throw new Error("migration de meal_history introuvable");
  return { nom, sql: lire(`drizzle/${nom}`) };
}

describe("migration meal_history (C9)", () => {
  it("est la 0017 et ne fait QUE créer : ni DROP, ni DELETE, ni INSERT, ni UPDATE", () => {
    const { nom, sql } = migrationHistorique();
    expect(nom).toMatch(/^0017_/);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bDELETE\b(?!\s+set null)/i);
    expect(sql).not.toMatch(/\bINSERT\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b(?!\s+no action)/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
  });

  it("n'altère que meal_history (contraintes ajoutées sur la nouvelle table seulement)", () => {
    const { sql } = migrationHistorique();
    const alteres = [...sql.matchAll(/ALTER TABLE "(\w+)"/gi)].map((m) => m[1]);
    expect(alteres.every((t) => t === "meal_history")).toBe(true);
  });

  it("unicité sur batch_recipe_id (C2) et ON DELETE set null sur les trois clés (C4)", () => {
    const { sql } = migrationHistorique();
    expect(sql).toMatch(/"batch_recipe_id" integer[^,\n]*UNIQUE|UNIQUE\("batch_recipe_id"\)|unique\("batch_recipe_id"\)/i);
    for (const col of ["batch_recipe_id", "batch_id", "recipe_id"]) {
      const fk = new RegExp(`FOREIGN KEY \\("${col}"\\)[^;]*ON DELETE set null`, "i");
      expect(sql, col).toMatch(fk);
    }
  });
});

describe("écriture de l'historique (C2, C11, atomicité)", () => {
  const actions = lire("lib/actions/batch.ts");
  const bloc = actions.slice(actions.indexOf("export async function setBatchStatus"));
  const setBatchStatus = bloc.slice(0, bloc.indexOf("\nexport ", 1));

  it("setBatchStatus revérifie la session, puis passe par db.batch", () => {
    expect(setBatchStatus).toContain("await requireSession()");
    expect(setBatchStatus.indexOf("await requireSession()")).toBeLessThan(setBatchStatus.indexOf("db.batch("));
    expect(setBatchStatus).toContain("requetesTerminer(");
    expect(setBatchStatus).toContain("requetesDeterminer(");
  });

  it("l'insertion ignore un doublon au lieu d'échouer (ON CONFLICT DO NOTHING)", () => {
    expect(lire("lib/historiqueDb.ts")).toContain("onConflictDoNothing");
  });

  it("historiqueDb reste un module ordinaire, jamais \"use server\" (M2)", () => {
    expect(lire("lib/historiqueDb.ts")).not.toMatch(/^\s*["']use server["']/);
  });
});
