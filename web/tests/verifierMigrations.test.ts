// La vérification post-migration (#213) : `drizzle-kit migrate` peut sortir en code 0 sans rien appliquer ; ces tests
// reproduisent cet échec silencieux (base vierge, base en retard) et prouvent que la vérification le voit, puis que la
// VRAIE chaîne de migrations du dépôt (appliquée sur PGlite) passe. Données fictives : aucune donnée métier.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { verifierMigrations, type LigneSuivi, type MigrationAttendue } from "@/lib/verifierMigrations";
import { creerBaseTest } from "./outils/basePglite";

const JOURNAL = fileURLToPath(new URL("../drizzle/meta/_journal.json", import.meta.url));
const attenduesDuDepot = (JSON.parse(readFileSync(JOURNAL, "utf8")) as { entries: MigrationAttendue[] }).entries.map((e) => ({
  tag: e.tag,
  when: e.when,
}));

const A: MigrationAttendue[] = [
  { tag: "0000_a", when: 100 },
  { tag: "0001_b", when: 200 },
  { tag: "0002_c", when: 300 },
];
const lignes = (...dates: (string | number | bigint)[]): LigneSuivi[] => dates.map((created_at) => ({ created_at }));

describe("verifierMigrations (pure)", () => {
  it("base à jour : ok, sans avertissement", () => {
    const v = verifierMigrations(A, lignes(100, 200, 300));
    expect(v).toMatchObject({ ok: true, avertissements: [] });
    expect(v.message).toContain("0002_c");
  });

  it("created_at rendu en texte par le pilote (bigint) : lu comme un nombre", () => {
    expect(verifierMigrations(A, lignes("100", "200", "300")).ok).toBe(true);
  });

  it("ÉCHEC SILENCIEUX 1 : la table de suivi n'existe pas (rien n'a été appliqué)", () => {
    const v = verifierMigrations(A, null);
    expect(v.ok).toBe(false);
    expect(v.message).toContain("n'existe pas");
  });

  it("ÉCHEC SILENCIEUX 2 : table créée mais vide", () => {
    const v = verifierMigrations(A, []);
    expect(v.ok).toBe(false);
    expect(v.message).toContain("vide");
  });

  it("ÉCHEC SILENCIEUX 3 : la dernière migration du dépôt manque dans la base", () => {
    const v = verifierMigrations(A, lignes(100, 200));
    expect(v.ok).toBe(false);
    expect(v.message).toContain("0002_c");
    expect(v.message).toContain("PAS dans la base");
  });

  it("base en AVANCE sur le code (déploiement plus ancien que la base) : échec dit comme tel", () => {
    const v = verifierMigrations(A, lignes(100, 200, 300, 400));
    expect(v.ok).toBe(false);
    expect(v.message).toContain("AVANCE");
  });

  it("migration intermédiaire sans ligne : ok mais AVERTISSEMENT nommé (pas de blocage de la production)", () => {
    const v = verifierMigrations(A, lignes(100, 300));
    expect(v.ok).toBe(true);
    expect(v.ok && v.avertissements.join(" ")).toContain("0001_b");
  });

  it("created_at illisible : échec (état non vérifiable), jamais « ok »", () => {
    expect(verifierMigrations(A, lignes("n'importe quoi")).ok).toBe(false);
  });

  it("journal vide : échec (dossier drizzle/ incomplet)", () => {
    expect(verifierMigrations([], lignes(100)).ok).toBe(false);
  });
});

describe("verifierMigrations sur le vrai journal du dépôt (PGlite)", () => {
  it("le journal n'est pas vide et l'ordre des `when` est strictement croissant", () => {
    expect(attenduesDuDepot.length).toBeGreaterThan(0);
    for (let i = 1; i < attenduesDuDepot.length; i += 1) {
      expect(attenduesDuDepot[i]!.when, attenduesDuDepot[i]!.tag).toBeGreaterThan(attenduesDuDepot[i - 1]!.when);
    }
  });

  it("base vierge (migrate « sorti en 0 sans rien faire ») : la table de suivi est absente → échec", async () => {
    const base = drizzle(new PGlite());
    const r = await base.execute<{ t: string | null }>(sql`select to_regclass('drizzle.__drizzle_migrations') as t`);
    expect(r.rows[0]?.t ?? null).toBeNull();
    expect(verifierMigrations(attenduesDuDepot, null).ok).toBe(false);
  });

  it("après les VRAIES migrations du dépôt : la dernière est dans la table de suivi → ok, sans avertissement", async () => {
    const base = await creerBaseTest();
    const r = await base.execute<LigneSuivi>(sql`select created_at from drizzle.__drizzle_migrations`);
    const v = verifierMigrations(attenduesDuDepot, r.rows);
    expect(v).toMatchObject({ ok: true, avertissements: [] });
  });

  it("migrations appliquées puis dernière ligne perdue (retard d'une migration) → échec", async () => {
    const base = await creerBaseTest();
    await base.execute(sql`delete from drizzle.__drizzle_migrations where created_at = (select max(created_at) from drizzle.__drizzle_migrations)`);
    const r = await base.execute<LigneSuivi>(sql`select created_at from drizzle.__drizzle_migrations`);
    const v = verifierMigrations(attenduesDuDepot, r.rows);
    expect(v.ok).toBe(false);
    expect(v.message).toContain(attenduesDuDepot[attenduesDuDepot.length - 1]!.tag);
  });
});
