// lib/actionsInternes/batch.ts — création d'un batch (travail, sans contrôle d'accès).
//
// Module ORDINAIRE (pas de "use server") : une fonction de travail exportée d'un fichier
// "use server" deviendrait une Server Action appelable depuis le navigateur SANS session
// (faille M2). Deux appelants autorisés, chacun avec SA preuve : la Server Action (session)
// et la route MCP (jeton `MCP_TOKEN`).

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { aggregateShoppingList, fillMissingCosts } from "@/lib/aggregate";
import { ecarterIngredientsDeFond } from "@/lib/ingredientsDeFond";
import { estimateShoppingCosts } from "@/lib/llm";
import { fail, type ActionResult } from "./commun";

/**
 * Le TRAVAIL de création d'un batch, sans contrôle d'accès.
 *
 * ⚠️ Ne JAMAIS appeler depuis un point d'entrée qui n'a pas fait son propre contrôle.
 * Deux appelants autorisés, chacun avec SA preuve : la Server Action (session utilisateur)
 * et la route MCP (jeton `MCP_TOKEN`). Séparer la logique de l'autorisation évite de
 * réécrire les garde-fous — ingrédients de fond écartés, estimation de prix, agrégation —
 * une deuxième fois pour Claude, avec la dérive que ça garantirait.
 */
export async function creerBatchInterne(input: {
  name: string;
  selections: Array<{ recipeId: number; portions: number }>;
}): Promise<(ActionResult & { id?: number; estimationError?: string })> {
  try {
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

    const agregeComplet = aggregateShoppingList(
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

    // Sel, poivre et eau ne vont jamais sur une liste d'épicerie (demande de Marc, 17/08).
    // AUTOMATIQUE et sans rien à tenir à jour — l'inverse du garde-manger déclaratif retiré
    // le même jour. L'écart est DIT à l'écran (`/courses/[id]`), jamais silencieux.
    const { aAcheter: aggregated } = ecarterIngredientsDeFond(agregeComplet);

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
        .set({ estCost: cost })
        .where(eq(schema.shoppingItems.id, item.id));
    }

    revalidatePath("/batchs");
    return { ok: true, id: batch.id, estimationError };
  } catch (err) {
    return fail(err);
  }
}
