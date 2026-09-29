// Fonctions de TRAVAIL (`*Interne`) : ce qu'elles écrivent réellement en base.
//
// Elles ne contrôlent PAS l'accès (c'est le rôle de leurs appelants : Server Action avec
// session, route MCP avec jeton). Leurs refus sont donc des refus de CONTENU ; le refus
// « session absente » se teste sur les Server Actions (tests/actionsSession.test.ts).
//
// Base : Postgres en mémoire (PGlite) aux migrations de production, vide au départ. Les
// valeurs posées sont des libellés de test neutres, jamais présentées comme des données de Marc.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { BaseTest } from "./outils/basePglite";

vi.mock("@/lib/db", async () => {
  const { creerBaseTest } = await import("./outils/basePglite");
  const schema = await import("@/lib/db/schema");
  return { db: await creerBaseTest(), schema };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const estimateShoppingCosts = vi.fn();
vi.mock("@/lib/llm", () => ({
  estimateShoppingCosts: (...a: unknown[]) => estimateShoppingCosts(...a),
}));

import { db as dbModule, schema } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { viderBase } from "./outils/basePglite";
import { creerBatchInterne } from "@/lib/actionsInternes/batch";
import { ajouterDuCatalogueInterne } from "@/lib/actionsInternes/catalogue";
import { cocherArticleInterne } from "@/lib/actionsInternes/courses";

const db = dbModule as unknown as BaseTest;

beforeEach(async () => {
  vi.clearAllMocks();
  await viderBase(db);
});

/** Pose une recette de bibliothèque de test et ses ingrédients ; retourne son id. */
async function poserRecette(
  titre: string,
  servings: number,
  ingredients: Array<{ canonical: string; qty: number | null; unit: "g" | "ml" | "unite" | null }>,
): Promise<number> {
  const [r] = await db.insert(schema.recipes).values({ title: titre, servings }).returning();
  if (!r) throw new Error("insertion de test échouée");
  if (ingredients.length > 0) {
    await db.insert(schema.recipeIngredients).values(
      ingredients.map((i) => ({ recipeId: r.id, name: i.canonical, ...i })),
    );
  }
  return r.id;
}

describe("creerBatchInterne", () => {
  it("crée le batch, ses recettes et une liste agrégée entièrement chiffrée, sans le sel", async () => {
    const a = await poserRecette("recette-test-a", 2, [
      { canonical: "farine", qty: 200, unit: "g" },
      { canonical: "sel", qty: 5, unit: "g" },
    ]);
    const b = await poserRecette("recette-test-b", 4, [{ canonical: "farine", qty: 100, unit: "g" }]);
    // Le LLM ne chiffre rien : le filet déterministe doit quand même poser un prix.
    estimateShoppingCosts.mockImplementation(async (items: unknown[]) => items.map(() => null));

    const r = await creerBatchInterne({
      name: "  batch-test  ",
      selections: [
        { recipeId: a, portions: 4 },
        { recipeId: b, portions: 4 },
      ],
    });

    expect(r).toMatchObject({ ok: true });
    const batchs = await db.select().from(schema.batches);
    expect(batchs).toHaveLength(1);
    expect(batchs[0]?.name).toBe("batch-test");
    expect(await db.select().from(schema.batchRecipes)).toHaveLength(2);

    const articles = await db.select().from(schema.shoppingItems);
    expect(articles.map((x) => x.canonical)).toEqual(["farine"]);
    // 200 g pour 2 portions ×2 (400) + 100 g pour 4 portions ×1 (100) = 500 g.
    expect(articles[0]?.qty).toBe(500);
    expect(articles.every((x) => x.estCost !== null)).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/batchs");
  });

  it("une panne d'estimation n'empêche pas le batch et est DITE", async () => {
    const a = await poserRecette("recette-test", 1, [{ canonical: "riz", qty: 100, unit: "g" }]);
    estimateShoppingCosts.mockRejectedValue(new Error("estimation indisponible"));

    const r = await creerBatchInterne({ name: "batch-test", selections: [{ recipeId: a, portions: 1 }] });

    expect(r).toMatchObject({ ok: true, estimationError: "estimation indisponible" });
    const articles = await db.select().from(schema.shoppingItems);
    expect(articles).toHaveLength(1);
    expect(articles[0]?.estCost).not.toBeNull();
  });

  it("refuse un nom vide sans rien écrire", async () => {
    const a = await poserRecette("recette-test", 1, []);
    const r = await creerBatchInterne({ name: "   ", selections: [{ recipeId: a, portions: 1 }] });
    expect(r).toEqual({ ok: false, error: "Donne un nom au batch." });
    expect(await db.select().from(schema.batches)).toHaveLength(0);
  });

  it("refuse une sélection sans portion", async () => {
    const a = await poserRecette("recette-test", 1, []);
    const r = await creerBatchInterne({ name: "batch-test", selections: [{ recipeId: a, portions: 0 }] });
    expect(r).toEqual({ ok: false, error: "Choisis au moins une recette." });
  });

  it("refuse une recette introuvable sans créer de batch", async () => {
    const r = await creerBatchInterne({ name: "batch-test", selections: [{ recipeId: 999, portions: 1 }] });
    expect(r).toEqual({ ok: false, error: "Recette introuvable dans la sélection." });
    expect(await db.select().from(schema.batches)).toHaveLength(0);
  });
});

describe("ajouterDuCatalogueInterne", () => {
  async function poserCatalogue(titre: string, sourceUrl: string | null): Promise<number> {
    const [c] = await db
      .insert(schema.catalogRecipes)
      .values({ title: titre, sourceUrl, servings: 3, prepMinutes: 10, cuissonMinutes: 20, difficulteEstimee: 2 })
      .returning();
    if (!c) throw new Error("insertion de test échouée");
    await db
      .insert(schema.catalogIngredients)
      .values({ catalogRecipeId: c.id, name: "oignon", canonical: "oignon", qty: 1, unit: "unite" });
    return c.id;
  }

  it("copie les recettes absentes (champs et ingrédients) et ignore celles déjà présentes", async () => {
    const nouvelle = await poserCatalogue("catalogue-test-1", "https://exemple.test/1");
    const dejaLa = await poserCatalogue("catalogue-test-2", "https://exemple.test/2");
    await db.insert(schema.recipes).values({ title: "déjà copiée", sourceUrl: "https://exemple.test/2" });

    const r = await ajouterDuCatalogueInterne([nouvelle, dejaLa, nouvelle]);

    expect(r).toEqual({ ok: true, added: 1, skipped: 1 });
    const copie = (await db.select().from(schema.recipes).where(eq(schema.recipes.sourceUrl, "https://exemple.test/1")))[0];
    expect(copie).toMatchObject({
      title: "catalogue-test-1",
      origine: "catalogue",
      servings: 3,
      prepMinutes: 10,
      cuissonMinutes: 20,
      difficulteEstimee: 2,
    });
    const ings = await db.select().from(schema.recipeIngredients);
    expect(ings).toHaveLength(1);
    expect(ings[0]).toMatchObject({ recipeId: copie?.id, canonical: "oignon", qty: 1, unit: "unite" });
    expect(revalidatePath).toHaveBeenCalledWith("/recettes");
  });

  it("tout déjà présent : zéro ajout, compte honnête", async () => {
    const c = await poserCatalogue("catalogue-test", "https://exemple.test/x");
    await db.insert(schema.recipes).values({ title: "déjà copiée", sourceUrl: "https://exemple.test/x" });
    expect(await ajouterDuCatalogueInterne([c])).toEqual({ ok: true, added: 0, skipped: 1 });
  });

  it("refuse une sélection vide ou non entière", async () => {
    expect(await ajouterDuCatalogueInterne([])).toEqual({ ok: false, error: "Aucune recette sélectionnée." });
    expect(await ajouterDuCatalogueInterne([1.5])).toEqual({ ok: false, error: "Aucune recette sélectionnée." });
  });

  it("refuse des identifiants inconnus du catalogue", async () => {
    expect(await ajouterDuCatalogueInterne([4242])).toEqual({
      ok: false,
      error: "Recettes du catalogue introuvables.",
    });
  });
});

describe("cocherArticleInterne", () => {
  async function poserArticle(): Promise<number> {
    const [b] = await db.insert(schema.batches).values({ name: "batch-test" }).returning();
    if (!b) throw new Error("insertion de test échouée");
    const [i] = await db
      .insert(schema.shoppingItems)
      .values({ batchId: b.id, name: "article-test", canonical: "article-test" })
      .returning();
    if (!i) throw new Error("insertion de test échouée");
    return i.id;
  }

  it("coche en datant, décoche en effaçant la date", async () => {
    const id = await poserArticle();
    expect(await cocherArticleInterne(id, true)).toEqual({ ok: true });
    let [ligne] = await db.select().from(schema.shoppingItems).where(eq(schema.shoppingItems.id, id));
    expect(ligne?.checked).toBe(true);
    expect(ligne?.checkedAt).toBeInstanceOf(Date);

    expect(await cocherArticleInterne(id, false)).toEqual({ ok: true });
    [ligne] = await db.select().from(schema.shoppingItems).where(eq(schema.shoppingItems.id, id));
    expect(ligne?.checked).toBe(false);
    expect(ligne?.checkedAt).toBeNull();
  });

  it("une panne de base est rendue comme échec honnête, jamais avalée", async () => {
    const espion = vi.spyOn(db, "update").mockImplementationOnce(() => {
      throw new Error("base indisponible");
    });
    expect(await cocherArticleInterne(1, true)).toEqual({ ok: false, error: "base indisponible" });
    espion.mockRestore();
  });
});
