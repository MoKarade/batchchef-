"use server";

// lib/actions/recettes.ts — correction et suppression d'une recette de la bibliothèque.
//
// Server Actions : chaque export est un point d'entrée appelable depuis le navigateur, et
// revérifie donc la session EN TÊTE (défense en profondeur : le middleware garde déjà).
// Jamais de fonction `*Interne` ici (faille M2) : elles vivent dans lib/actionsInternes/.
// Chaque échec est retourné comme message honnête, jamais avalé.

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { clampServings, prepareIngredientRows, type EditableIngredient } from "@/lib/recipeEdit";
import { fail, isForeignKeyViolation, type ActionResult } from "@/lib/actionsInternes/commun";
import { requireSession } from "@/lib/actionsInternes/session";

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
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      return {
        ok: false,
        error: "Suppression impossible : la recette est utilisée par un batch.",
      };
    }
    return fail(err);
  }
}
