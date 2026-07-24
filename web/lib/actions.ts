"use server";

// lib/actions.ts — Server Actions de la Phase 1. Toute écriture revérifie la session
// côté serveur (défense en profondeur : le middleware garde déjà, mais les actions
// portent les écritures). Chaque échec est retourné comme message honnête, jamais avalé.

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { aggregateShoppingList, fillMissingCosts } from "@/lib/aggregate";
import { splitNewCatalogRecipes } from "@/lib/catalogSelect";
import { clampServings, prepareIngredientRows, type EditableIngredient } from "@/lib/recipeEdit";
import { estimateShoppingCosts, htmlToText, parseRecipeFromPage } from "@/lib/llm";

async function requireSession(): Promise<void> {
  const session = await auth();
  if (!session) throw new Error("Session requise.");
}

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(err: unknown): ActionResult {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/** Importe une recette depuis une URL (n'importe quel site) via le parse LLM. */
export async function importRecipeFromUrl(url: string): Promise<ActionResult & { id?: number }> {
  try {
    await requireSession();
    const parsed = new URL(url); // valide le format
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { ok: false, error: "URL http(s) uniquement." };
    }

    const page = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (BatchChef; +recette perso)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!page.ok) return { ok: false, error: `Page injoignable (HTTP ${page.status}).` };
    const recipe = await parseRecipeFromPage(htmlToText(await page.text()));

    const [row] = await db
      .insert(schema.recipes)
      .values({
        title: recipe.title,
        sourceUrl: url,
        imageUrl: recipe.imageUrl,
        servings: recipe.servings,
        instructions: recipe.instructions,
      })
      .returning({ id: schema.recipes.id });
    if (!row) return { ok: false, error: "Insertion de la recette échouée." };

    await db.insert(schema.recipeIngredients).values(
      recipe.ingredients.map((ing) => ({
        recipeId: row.id,
        name: ing.name,
        canonical: ing.canonical.toLowerCase().trim(),
        qty: ing.qty,
        unit: ing.qty === null ? null : ing.unit,
        note: ing.note,
      })),
    );

    revalidatePath("/recettes");
    return { ok: true, id: row.id };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Ajoute EN MASSE des recettes du catalogue à la bibliothèque perso. Idempotent sur la
 * source : une recette déjà présente (même sourceUrl) est ignorée, jamais dupliquée.
 * Retourne le nombre réellement ajouté et le nombre ignoré (déjà présent) — compte honnête.
 */
export async function addCatalogRecipesToLibrary(
  catalogRecipeIds: number[],
): Promise<ActionResult & { added?: number; skipped?: number }> {
  try {
    await requireSession();
    const ids = [...new Set(catalogRecipeIds)].filter((id) => Number.isInteger(id));
    if (ids.length === 0) return { ok: false, error: "Aucune recette sélectionnée." };

    const cats = await db.select().from(schema.catalogRecipes).where(inArray(schema.catalogRecipes.id, ids));
    if (cats.length === 0) return { ok: false, error: "Recettes du catalogue introuvables." };

    // Dédoublonnage sur la source : on ne réajoute pas ce qui est déjà dans la bibliothèque.
    const existing = await db.select({ sourceUrl: schema.recipes.sourceUrl }).from(schema.recipes);
    const { toAdd, skipped } = splitNewCatalogRecipes(
      cats.map((c) => ({ id: c.id, sourceUrl: c.sourceUrl })),
      existing.map((r) => r.sourceUrl).filter((u): u is string => u !== null),
    );
    if (toAdd.length === 0) return { ok: true, added: 0, skipped };

    const addIds = new Set(toAdd.map((c) => c.id));
    const catIngs = await db
      .select()
      .from(schema.catalogIngredients)
      .where(inArray(schema.catalogIngredients.catalogRecipeId, [...addIds]));

    // Insère chaque recette (id retourné), accumule tous les ingrédients pour une seule
    // insertion groupée à la fin (N+1 écritures au lieu de 2N).
    let added = 0;
    const ingRows: Array<typeof schema.recipeIngredients.$inferInsert> = [];
    for (const cat of cats) {
      if (!addIds.has(cat.id)) continue;
      const [row] = await db
        .insert(schema.recipes)
        .values({
          title: cat.title,
          sourceUrl: cat.sourceUrl,
          imageUrl: cat.imageUrl,
          servings: cat.servings,
          instructions: cat.instructions,
        })
        .returning({ id: schema.recipes.id });
      if (!row) continue;
      added++;
      for (const i of catIngs.filter((x) => x.catalogRecipeId === cat.id)) {
        ingRows.push({
          recipeId: row.id,
          name: i.name,
          canonical: i.canonical,
          qty: i.qty,
          unit: i.unit,
          note: i.note,
        });
      }
    }
    if (ingRows.length > 0) await db.insert(schema.recipeIngredients).values(ingRows);

    revalidatePath("/recettes");
    return { ok: true, added, skipped };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Corrige une recette de la bibliothèque : nombre de portions de RÉFÉRENCE + ingrédients
 * (nom, quantité, unité, note), avec ajout/suppression. C'est le levier du « 100 % précis » :
 * toute erreur de détection est corrigeable à la main. Les ingrédients sont remplacés en bloc
 * (suppression + réinsertion) — les batchs référencent la recette, pas les lignes, donc rien ne casse.
 */
export async function updateRecipe(input: {
  recipeId: number;
  servings: number;
  ingredients: EditableIngredient[];
}): Promise<ActionResult> {
  try {
    await requireSession();
    const servings = clampServings(input.servings);
    const rows = prepareIngredientRows(input.ingredients);
    if (rows.length === 0) return { ok: false, error: "Garde au moins un ingrédient (avec un nom)." };

    await db.update(schema.recipes).set({ servings }).where(eq(schema.recipes.id, input.recipeId));
    await db.delete(schema.recipeIngredients).where(eq(schema.recipeIngredients.recipeId, input.recipeId));
    await db.insert(schema.recipeIngredients).values(
      rows.map((r) => ({
        recipeId: input.recipeId,
        name: r.name,
        canonical: r.canonical,
        qty: r.qty,
        unit: r.unit,
        note: r.note,
      })),
    );

    revalidatePath(`/recettes/${input.recipeId}`);
    revalidatePath("/recettes");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteRecipe(recipeId: number): Promise<ActionResult> {
  try {
    await requireSession();
    // Une recette utilisée par un batch est protégée (FK restrict) : erreur honnête.
    await db.delete(schema.recipes).where(eq(schema.recipes.id, recipeId));
    revalidatePath("/recettes");
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Suppression impossible : la recette est utilisée par un batch.",
    };
  }
}

/**
 * Crée un batch depuis une sélection {recipeId, portions}, génère la liste d'épicerie
 * agrégée, puis tente l'estimation de budget LLM. L'estimation est BEST-EFFORT : si elle
 * échoue (clé absente, réseau), le batch existe quand même — items sans coût, marqués
 * inconnus, jamais un chiffre inventé.
 */
export async function createBatch(input: {
  name: string;
  selections: Array<{ recipeId: number; portions: number }>;
}): Promise<(ActionResult & { id?: number; estimationError?: string })> {
  try {
    await requireSession();
    const name = input.name.trim();
    const selections = input.selections.filter((s) => s.portions >= 1);
    if (!name) return { ok: false, error: "Donne un nom au batch." };
    if (selections.length === 0) return { ok: false, error: "Choisis au moins une recette." };

    const ids = selections.map((s) => s.recipeId);
    const recipeRows = await db
      .select()
      .from(schema.recipes)
      .where(inArray(schema.recipes.id, ids));
    if (recipeRows.length !== ids.length) {
      return { ok: false, error: "Recette introuvable dans la sélection." };
    }
    const ingredientRows = await db
      .select()
      .from(schema.recipeIngredients)
      .where(inArray(schema.recipeIngredients.recipeId, ids));

    const aggregated = aggregateShoppingList(
      selections.map((sel) => {
        const recipe = recipeRows.find((r) => r.id === sel.recipeId)!;
        return {
          servings: recipe.servings,
          portions: sel.portions,
          ingredients: ingredientRows
            .filter((i) => i.recipeId === sel.recipeId)
            .map((i) => ({ name: i.name, canonical: i.canonical, qty: i.qty, unit: i.unit })),
        };
      }),
    );

    const [batch] = await db
      .insert(schema.batches)
      .values({ name })
      .returning({ id: schema.batches.id });
    if (!batch) return { ok: false, error: "Création du batch échouée." };

    await db.insert(schema.batchRecipes).values(
      selections.map((s) => ({ batchId: batch.id, recipeId: s.recipeId, portions: s.portions })),
    );
    // Insertion AVEC returning : on récupère les id dans l'ordre d'`aggregated`, ce qui
    // permet de recoller les coûts par INDEX (pas par nom) — matching sûr à 100 %.
    const insertedItems = await db
      .insert(schema.shoppingItems)
      .values(
        aggregated.map((item) => ({
          batchId: batch.id,
          name: item.name,
          canonical: item.canonical,
          qty: item.qty,
          unit: item.unit,
        })),
      )
      .returning({ id: schema.shoppingItems.id });

    // Estimation : couverture 100 % garantie. Le LLM chiffre ce qu'il peut ; un filet
    // déterministe (fillMissingCosts) donne un prix à TOUT le reste — même si le LLM est
    // indisponible, aucun article ne part sans prix. Reste une estimation honnête.
    let estimationError: string | undefined;
    let llmCosts: Array<number | null> = new Array(aggregated.length).fill(null);
    try {
      llmCosts = await estimateShoppingCosts(aggregated); // aligné sur `aggregated`
    } catch (err) {
      estimationError = err instanceof Error ? err.message : String(err);
    }
    const costs = fillMissingCosts(aggregated, llmCosts);
    for (let idx = 0; idx < costs.length; idx++) {
      const item = insertedItems[idx];
      const cost = costs[idx];
      if (!item || cost === undefined) continue;
      await db
        .update(schema.shoppingItems)
        .set({ estCost: cost, costKind: "estime" })
        .where(eq(schema.shoppingItems.id, item.id));
    }

    revalidatePath("/batchs");
    return { ok: true, id: batch.id, estimationError };
  } catch (err) {
    return fail(err);
  }
}

export async function toggleShoppingItem(itemId: number, checked: boolean): Promise<ActionResult> {
  try {
    await requireSession();
    await db
      .update(schema.shoppingItems)
      .set({ checked, checkedAt: checked ? new Date() : null })
      .where(eq(schema.shoppingItems.id, itemId));
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function setBatchStatus(
  batchId: number,
  status: "planifie" | "courses" | "cuisine" | "termine",
): Promise<ActionResult> {
  try {
    await requireSession();
    await db.update(schema.batches).set({ status }).where(eq(schema.batches.id, batchId));
    revalidatePath("/batchs");
    revalidatePath(`/batchs/${batchId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteBatch(batchId: number): Promise<ActionResult> {
  try {
    await requireSession();
    await db.delete(schema.batches).where(eq(schema.batches.id, batchId));
    revalidatePath("/batchs");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Copie une recette du CATALOGUE de découverte vers la bibliothèque perso. Duplication
 * pure (le catalogue reste intact) ; les ingrédients sont déjà normalisés à l'import.
 */
export async function addCatalogRecipeToLibrary(
  catalogRecipeId: number,
): Promise<ActionResult & { id?: number }> {
  try {
    await requireSession();
    const [cat] = await db
      .select()
      .from(schema.catalogRecipes)
      .where(eq(schema.catalogRecipes.id, catalogRecipeId));
    if (!cat) return { ok: false, error: "Recette du catalogue introuvable." };

    const catIngs = await db
      .select()
      .from(schema.catalogIngredients)
      .where(eq(schema.catalogIngredients.catalogRecipeId, catalogRecipeId));

    const [row] = await db
      .insert(schema.recipes)
      .values({
        title: cat.title,
        sourceUrl: cat.sourceUrl,
        imageUrl: cat.imageUrl,
        servings: cat.servings,
        instructions: cat.instructions,
      })
      .returning({ id: schema.recipes.id });
    if (!row) return { ok: false, error: "Copie de la recette échouée." };

    if (catIngs.length > 0) {
      await db.insert(schema.recipeIngredients).values(
        catIngs.map((i) => ({
          recipeId: row.id,
          name: i.name,
          canonical: i.canonical,
          qty: i.qty,
          unit: i.unit,
          note: i.note,
        })),
      );
    }

    revalidatePath("/recettes");
    return { ok: true, id: row.id };
  } catch (err) {
    return fail(err);
  }
}
