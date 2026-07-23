"use server";

// lib/actions.ts — Server Actions de la Phase 1. Toute écriture revérifie la session
// côté serveur (défense en profondeur : le middleware garde déjà, mais les actions
// portent les écritures). Chaque échec est retourné comme message honnête, jamais avalé.

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { aggregateShoppingList } from "@/lib/aggregate";
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
    await db.insert(schema.shoppingItems).values(
      aggregated.map((item) => ({
        batchId: batch.id,
        name: item.name,
        canonical: item.canonical,
        qty: item.qty,
        unit: item.unit,
      })),
    );

    // Estimation best-effort — l'échec n'annule jamais le batch.
    let estimationError: string | undefined;
    try {
      const estimate = await estimateShoppingCosts(aggregated);
      for (const est of estimate.items) {
        if (est.estCost === null) continue;
        await db
          .update(schema.shoppingItems)
          .set({ estCost: est.estCost, costKind: "estime" })
          .where(
            and(
              eq(schema.shoppingItems.batchId, batch.id),
              eq(schema.shoppingItems.canonical, est.canonical.toLowerCase().trim()),
            ),
          );
      }
    } catch (err) {
      estimationError = err instanceof Error ? err.message : String(err);
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
