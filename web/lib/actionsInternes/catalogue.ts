// lib/actionsInternes/catalogue.ts — copie depuis le catalogue (travail, sans contrôle d'accès).
//
// Module ORDINAIRE (pas de "use server") : une fonction de travail exportée d'un fichier
// "use server" deviendrait une Server Action appelable depuis le navigateur SANS session
// (faille M2). Deux appelants autorisés, chacun avec SA preuve : la Server Action (session)
// et la route MCP (jeton `MCP_TOKEN`).

import { revalidatePath } from "next/cache";
import { inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { splitNewCatalogRecipes } from "@/lib/catalogSelect";
import { fail, type ActionResult } from "./commun";

/** Le TRAVAIL de copie depuis le catalogue, sans contrôle d'accès (cf. `creerBatchInterne`). */
export async function ajouterDuCatalogueInterne(
  catalogRecipeIds: number[],
): Promise<ActionResult & { added?: number; skipped?: number }> {
  try {
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
          origine: "catalogue",
          imageUrl: cat.imageUrl,
          servings: cat.servings,
          instructions: cat.instructions,
          // ⚠️ Tout champ ajouté au catalogue doit être recopié ICI aussi, sinon la
          // bibliothèque le perd en silence. Verrouillé par tests/tempsRecette.test.ts.
          prepMinutes: cat.prepMinutes,
          cuissonMinutes: cat.cuissonMinutes,
          // La note suit la recette : sans elle, une recette piochée au catalogue
          // afficherait « difficulté non estimée » dans la bibliothèque jusqu'au prochain
          // déploiement — donc un manque annoncé là où la note existe.
          difficulteEstimee: cat.difficulteEstimee,
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
