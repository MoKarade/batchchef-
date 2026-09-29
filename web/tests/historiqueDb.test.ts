// HIST-01 — l'écriture de l'historique sur un VRAI Postgres (PGlite, migrations du dépôt).
// C1 (N lignes copiées), C2 (pas de doublon), C3 (recul efface, nouveau « Terminé » recrée),
// C4 (batch supprimé : la trace reste), C5 (recette supprimée : titre gardé), C10 (migrations
// rejouées sans effet). Base vide au départ ; valeurs de test neutres.
//
// ⚠️ PGlite n'a pas `db.batch` (propre au pilote Neon HTTP) : le test le remplace par une
// exécution dans l'ordre. L'ATOMICITÉ elle-même relève de Neon et n'est pas prouvée ici —
// seulement le contenu et l'ordre des requêtes passées au lot.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { BaseTest } from "./outils/basePglite";

vi.mock("@/lib/db", async () => {
  const { creerBaseTest } = await import("./outils/basePglite");
  const schema = await import("@/lib/db/schema");
  const base = await creerBaseTest();
  const batch = async (requetes: readonly PromiseLike<unknown>[]) => {
    const res: unknown[] = [];
    for (const r of requetes) res.push(await r);
    return res;
  };
  return { db: Object.assign(base, { batch }), schema };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => auth(...a) }));

import { db as dbModule, schema } from "@/lib/db";
import { deleteBatch, setBatchStatus } from "@/lib/actions/batch";
import { deleteRecipe } from "@/lib/actions/recettes";
import { lireHistorique } from "@/lib/historiqueDb";
import { creerBaseTest, viderBase } from "./outils/basePglite";

const db = dbModule as unknown as BaseTest;

beforeEach(async () => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { email: "session-de-test" } });
  await viderBase(db);
});

/** Un batch de test à deux recettes ; retourne les ids. */
async function poserBatch(): Promise<{ batchId: number; r1: number; r2: number }> {
  const [r1] = await db
    .insert(schema.recipes)
    .values({ title: "recette-test-1", sourceUrl: "https://exemple.test/1" })
    .returning();
  const [r2] = await db.insert(schema.recipes).values({ title: "recette-test-2" }).returning();
  const [b] = await db.insert(schema.batches).values({ name: "batch-test" }).returning();
  if (!r1 || !r2 || !b) throw new Error("insertion de test échouée");
  await db.insert(schema.batchRecipes).values([
    { batchId: b.id, recipeId: r1.id, portions: 6 },
    { batchId: b.id, recipeId: r2.id, portions: 2 },
  ]);
  return { batchId: b.id, r1: r1.id, r2: r2.id };
}

const lignes = () => db.select().from(schema.mealHistory).orderBy(schema.mealHistory.titre);

describe("setBatchStatus → historique", () => {
  it("C1 : « Terminé » crée une ligne par recette, avec les copies exactes", async () => {
    const { batchId, r1, r2 } = await poserBatch();
    expect(await setBatchStatus(batchId, "termine")).toEqual({ ok: true });

    const l = await lignes();
    expect(l).toHaveLength(2);
    expect(l[0]).toMatchObject({
      batchId,
      recipeId: r1,
      titre: "recette-test-1",
      sourceUrl: "https://exemple.test/1",
      nomBatch: "batch-test",
      portions: 6,
    });
    expect(l[1]).toMatchObject({ recipeId: r2, titre: "recette-test-2", sourceUrl: null, portions: 2 });
    expect(l.every((x) => x.cuisineLe instanceof Date && x.batchRecipeId !== null)).toBe(true);
    const [batch] = await db.select().from(schema.batches).where(eq(schema.batches.id, batchId));
    expect(batch?.status).toBe("termine");
  });

  it("C2 : toucher « Terminé » deux fois ne crée aucun doublon", async () => {
    const { batchId } = await poserBatch();
    await setBatchStatus(batchId, "termine");
    await setBatchStatus(batchId, "termine");
    expect(await lignes()).toHaveLength(2);
  });

  it("les autres étapes n'écrivent rien", async () => {
    const { batchId } = await poserBatch();
    for (const s of ["courses", "cuisine", "planifie"] as const) await setBatchStatus(batchId, s);
    expect(await lignes()).toHaveLength(0);
  });

  it("C3 : un recul efface la trace, un nouveau « Terminé » la recrée avec une nouvelle date", async () => {
    const { batchId } = await poserBatch();
    await setBatchStatus(batchId, "termine");
    const avant = (await lignes())[0]?.cuisineLe;

    await setBatchStatus(batchId, "cuisine");
    expect(await lignes()).toHaveLength(0);

    await new Promise((r) => setTimeout(r, 20));
    await setBatchStatus(batchId, "termine");
    const apres = await lignes();
    expect(apres).toHaveLength(2);
    expect(apres[0]?.cuisineLe.getTime()).toBeGreaterThan(avant?.getTime() ?? Infinity);
  });

  it("le recul d'un batch n'efface pas la trace d'un AUTRE batch", async () => {
    const a = await poserBatch();
    const [b] = await db.insert(schema.batches).values({ name: "autre-batch" }).returning();
    if (!b) throw new Error("insertion de test échouée");
    await db.insert(schema.batchRecipes).values({ batchId: b.id, recipeId: a.r1, portions: 1 });
    await setBatchStatus(a.batchId, "termine");
    await setBatchStatus(b.id, "termine");

    await setBatchStatus(a.batchId, "cuisine");
    const l = await lignes();
    expect(l.map((x) => x.nomBatch)).toEqual(["autre-batch"]);
  });

  it("C4 + C5 : batch puis recette supprimés, la trace reste avec ses copies", async () => {
    const { batchId, r2 } = await poserBatch();
    await setBatchStatus(batchId, "termine");

    expect(await deleteBatch(batchId)).toEqual({ ok: true });
    // Plus aucun batch ne la protège : la recette peut être supprimée.
    expect(await deleteRecipe(r2)).toEqual({ ok: true });

    const l = await lignes();
    expect(l).toHaveLength(2);
    expect(l.every((x) => x.batchId === null && x.batchRecipeId === null)).toBe(true);
    expect(l[1]).toMatchObject({ titre: "recette-test-2", recipeId: null, nomBatch: "batch-test", portions: 2 });

    // Et la lecture le rend tel quel, du plus récent au plus ancien.
    expect((await lireHistorique()).map((x) => x.titre).sort()).toEqual(["recette-test-1", "recette-test-2"]);
  });

  it("sans session : refus, rien d'écrit", async () => {
    const { batchId } = await poserBatch();
    auth.mockResolvedValue(null);
    expect(await setBatchStatus(batchId, "termine")).toEqual({ ok: false, error: "Session requise." });
    expect(await lignes()).toHaveLength(0);
  });
});

describe("C10 : les migrations rejouées ne font rien", () => {
  it("une seconde passe ne crée ni n'altère rien", async () => {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const { fileURLToPath } = await import("node:url");
    const base = await creerBaseTest();
    const avant = await (base as unknown as { $client: { query: (q: string) => Promise<{ rows: unknown[] }> } }).$client.query("select count(*)::int as n from drizzle.__drizzle_migrations");
    await migrate(base, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
    const apres = await (base as unknown as { $client: { query: (q: string) => Promise<{ rows: unknown[] }> } }).$client.query("select count(*)::int as n from drizzle.__drizzle_migrations");
    expect(apres.rows).toEqual(avant.rows);
    const tables = await (base as unknown as { $client: { query: (q: string) => Promise<{ rows: unknown[] }> } }).$client.query(
      "select count(*)::int as n from information_schema.tables where table_name = 'meal_history'",
    );
    expect(tables.rows).toEqual([{ n: 1 }]);
  });
});
