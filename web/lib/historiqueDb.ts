// lib/historiqueDb.ts — HIST-01 : la moitié IMPURE de l'historique (requêtes en base).
//
// ⚠️ Module ORDINAIRE, jamais "use server" : il n'est appelé que par une Server Action qui a
// déjà vérifié la session (`setBatchStatus`) et par la page `/historique` (sous middleware).
//
// Les deux fonctions d'écriture RENDENT des requêtes au lieu de les exécuter : l'appelant les
// passe dans le même `db.batch` que le changement de statut. Si l'historique ne s'écrit pas,
// le statut ne change pas non plus (arbitrage du plan HIST-01 §1.7 : une trace manquante
// serait invisible à l'écran, et la fréquence mentirait par omission).

import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { LigneHistorique } from "@/lib/historique";

/**
 * « Terminé » : une ligne par recette du batch, recopiée depuis `batch_recipes`, `recipes` et
 * `batches`. `ON CONFLICT DO NOTHING` sur `batch_recipe_id` : un double clic ou deux onglets
 * ne créent pas de doublon, et ne font pas échouer le lot.
 */
export function requetesTerminer(batchId: number) {
  return db
    .insert(schema.mealHistory)
    .select(
      // ⚠️ Drizzle exige, pour un INSERT … SELECT, TOUTES les colonnes de la table dans
      // l'ordre du schéma : `id` prend donc la valeur de sa séquence et `cuisine_le` vaut
      // `now()`, exactement ce que leurs valeurs par défaut donneraient.
      db
        .select({
          id: sql<number>`nextval(pg_get_serial_sequence('meal_history', 'id'))`.as("id"),
          batchRecipeId: schema.batchRecipes.id,
          batchId: schema.batchRecipes.batchId,
          recipeId: schema.batchRecipes.recipeId,
          titre: schema.recipes.title,
          sourceUrl: schema.recipes.sourceUrl,
          nomBatch: schema.batches.name,
          portions: schema.batchRecipes.portions,
          cuisineLe: sql<Date>`now()`.as("cuisine_le"),
        })
        .from(schema.batchRecipes)
        .innerJoin(schema.recipes, eq(schema.recipes.id, schema.batchRecipes.recipeId))
        .innerJoin(schema.batches, eq(schema.batches.id, schema.batchRecipes.batchId))
        .where(eq(schema.batchRecipes.batchId, batchId)),
    )
    .onConflictDoNothing({ target: schema.mealHistory.batchRecipeId });
}

/**
 * Recul depuis « Terminé » : la trace de CE batch est effacée — garder la ligne affirmerait
 * une cuisson qui n'a pas eu lieu (décision de Marc). Sans effet si le batch n'en a pas.
 */
export function requetesDeterminer(batchId: number) {
  return db.delete(schema.mealHistory).where(eq(schema.mealHistory.batchId, batchId));
}

/** Toutes les lignes, de la plus récente à la plus ancienne. */
export async function lireHistorique(): Promise<LigneHistorique[]> {
  return db
    .select({
      id: schema.mealHistory.id,
      batchId: schema.mealHistory.batchId,
      recipeId: schema.mealHistory.recipeId,
      titre: schema.mealHistory.titre,
      sourceUrl: schema.mealHistory.sourceUrl,
      nomBatch: schema.mealHistory.nomBatch,
      portions: schema.mealHistory.portions,
      cuisineLe: schema.mealHistory.cuisineLe,
    })
    .from(schema.mealHistory)
    .orderBy(desc(schema.mealHistory.cuisineLe), schema.mealHistory.id);
}
