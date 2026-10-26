// Les trois écritures de BatchChef programment bien leur sortie vers MemoryAI (batchchef-#320),
// seulement APRÈS une écriture réussie, et une défaillance de la sortie ne casse jamais l'écriture.
// Base : PGlite aux migrations de production. Valeurs de test neutres.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseTest } from "./outils/basePglite";

vi.mock("@/lib/db", async () => {
  const { creerBaseTest } = await import("./outils/basePglite");
  const schema = await import("@/lib/db/schema");
  return { db: await creerBaseTest(), schema };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/llm", () => ({ estimateShoppingCosts: vi.fn(async () => []) }));
const planifierSorties = vi.fn();
vi.mock("@/lib/sortiesMemoryAI", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sortiesMemoryAI")>()),
  planifierSorties: (...a: unknown[]) => planifierSorties(...a),
}));

import { db as dbModule, schema } from "@/lib/db";
import { viderBase } from "./outils/basePglite";
import { creerBatchInterne } from "@/lib/actionsInternes/batch";
import { ajouterDuCatalogueInterne } from "@/lib/actionsInternes/catalogue";
import { cocherArticleInterne } from "@/lib/actionsInternes/courses";

const db = dbModule as unknown as BaseTest;

beforeEach(async () => {
  vi.clearAllMocks();
  await viderBase(db);
});

function evenementsPlanifies() {
  return planifierSorties.mock.calls.flatMap((c) => c[0] as Array<Record<string, string>>);
}

describe("sortie d'un batch créé", () => {
  it("programme un événement batch_cree avec le nom, les comptes et la ref du batch", async () => {
    const [r] = await db.insert(schema.recipes).values({ title: "recette-test", servings: 2 }).returning();
    await db
      .insert(schema.recipeIngredients)
      .values({ recipeId: r!.id, name: "oignon", canonical: "oignon", qty: 2, unit: "unite" });

    const res = await creerBatchInterne({ name: "batch-test", selections: [{ recipeId: r!.id, portions: 2 }] });

    expect(res.ok).toBe(true);
    expect(evenementsPlanifies()).toEqual([
      expect.objectContaining({
        type: "batch_cree",
        titre: "Batch créé · batch-test",
        ref: `batchchef-batch-${res.id}`,
      }),
    ]);
  });

  it("ne programme rien quand la création est refusée", async () => {
    expect((await creerBatchInterne({ name: "x", selections: [] })).ok).toBe(false);
    expect(planifierSorties).not.toHaveBeenCalled();
  });
});

describe("sortie d'une recette ajoutée du catalogue", () => {
  it("programme un événement par recette réellement copiée, pas pour les déjà présentes", async () => {
    const [c1] = await db
      .insert(schema.catalogRecipes)
      .values({ title: "catalogue-test-1", sourceUrl: "https://exemple.test/1", servings: 2 })
      .returning();
    const [c2] = await db
      .insert(schema.catalogRecipes)
      .values({ title: "catalogue-test-2", sourceUrl: "https://exemple.test/2", servings: 2 })
      .returning();
    await db.insert(schema.recipes).values({ title: "déjà là", sourceUrl: "https://exemple.test/2" });

    expect(await ajouterDuCatalogueInterne([c1!.id, c2!.id])).toEqual({ ok: true, added: 1, skipped: 1 });

    const evenements = evenementsPlanifies();
    expect(evenements).toHaveLength(1);
    expect(evenements[0]).toMatchObject({
      type: "recette_ajoutee",
      titre: "Recette ajoutée · catalogue-test-1",
    });
  });

  it("ne programme rien quand tout est déjà présent", async () => {
    const [c] = await db
      .insert(schema.catalogRecipes)
      .values({ title: "catalogue-test", sourceUrl: "https://exemple.test/x", servings: 2 })
      .returning();
    await db.insert(schema.recipes).values({ title: "déjà là", sourceUrl: "https://exemple.test/x" });
    await ajouterDuCatalogueInterne([c!.id]);
    expect(planifierSorties).not.toHaveBeenCalled();
  });
});

describe("sortie d'une liste d'épicerie terminée", () => {
  async function poserListe(): Promise<{ batchId: number; ids: number[] }> {
    const [b] = await db.insert(schema.batches).values({ name: "batch-test" }).returning();
    const items = await db
      .insert(schema.shoppingItems)
      .values([
        { batchId: b!.id, name: "a", canonical: "a" },
        { batchId: b!.id, name: "b", canonical: "b" },
      ])
      .returning();
    return { batchId: b!.id, ids: items.map((i) => i.id) };
  }

  it("ne programme rien tant qu'il reste un article à cocher", async () => {
    const { ids } = await poserListe();
    expect(await cocherArticleInterne(ids[0]!, true)).toEqual({ ok: true });
    expect(planifierSorties).not.toHaveBeenCalled();
  });

  it("programme liste_terminee quand le dernier article est coché, jamais en décochant", async () => {
    const { batchId, ids } = await poserListe();
    await cocherArticleInterne(ids[0]!, true);
    await cocherArticleInterne(ids[1]!, true);
    expect(evenementsPlanifies()).toEqual([
      expect.objectContaining({
        type: "liste_terminee",
        titre: "Liste d'épicerie terminée · batch-test",
        ref: `batchchef-liste-${batchId}`,
      }),
    ]);
    planifierSorties.mockClear();
    await cocherArticleInterne(ids[1]!, false);
    expect(planifierSorties).not.toHaveBeenCalled();
  });

  it("une défaillance de la sortie ne fait pas échouer le cochage", async () => {
    const { ids } = await poserListe();
    planifierSorties.mockImplementation(() => {
      throw new Error("sortie en panne");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await cocherArticleInterne(ids[0]!, true);
    expect(await cocherArticleInterne(ids[1]!, true)).toEqual({ ok: true });
  });
});
