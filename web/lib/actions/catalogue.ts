"use server";

// lib/actions/catalogue.ts — du catalogue de découverte vers la bibliothèque, et correction du type.
//
// Server Actions : chaque export est un point d'entrée appelable depuis le navigateur, et
// revérifie donc la session EN TÊTE (défense en profondeur : le middleware garde déjà).
// Jamais de fonction `*Interne` ici (faille M2) : elles vivent dans lib/actionsInternes/.
// Chaque échec est retourné comme message honnête, jamais avalé.

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { estTypePlat, type TypePlat } from "@/lib/typePlat";
import { ajouterDuCatalogueInterne } from "@/lib/actionsInternes/catalogue";
import { fail, type ActionResult } from "@/lib/actionsInternes/commun";
import { requireSession } from "@/lib/actionsInternes/session";

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
    return await ajouterDuCatalogueInterne(catalogRecipeIds);
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
        origine: "catalogue",
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

/**
 * Corrige le type d'une recette du catalogue (SEM-01). `null` = « aucune de ces familles ».
 *
 * ⚠️ La correction est indexée par `source_url`, jamais par l'id : `npm run catalog:import`
 * reconstruit le catalogue et change les ids. Une correction indexée par id disparaîtrait à
 * la première réimportation, sans la moindre erreur.
 *
 * ⚠️ Une recette du catalogue SANS source ne peut pas être corrigée — et on le DIT, plutôt
 * que d'accepter le clic et de perdre la correction en silence.
 */
export async function corrigerTypeRecette(
  catalogRecipeId: number,
  type: TypePlat | null,
): Promise<ActionResult> {
  try {
    await requireSession();
    if (type !== null && !estTypePlat(type)) return { ok: false, error: "Type inconnu." };
    const [recette] = await db
      .select({ sourceUrl: schema.catalogRecipes.sourceUrl })
      .from(schema.catalogRecipes)
      .where(eq(schema.catalogRecipes.id, catalogRecipeId));
    if (!recette) return { ok: false, error: "Cette recette n'existe plus." };
    if (!recette.sourceUrl) {
      return { ok: false, error: "Cette recette n'a pas de source : sa correction ne survivrait pas." };
    }

    await db
      .insert(schema.typeCorrections)
      .values({ sourceUrl: recette.sourceUrl, type })
      .onConflictDoUpdate({ target: schema.typeCorrections.sourceUrl, set: { type } });

    revalidatePath("/catalogue");
    revalidatePath(`/catalogue/${catalogRecipeId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
