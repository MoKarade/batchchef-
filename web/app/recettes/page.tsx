// /recettes — bibliothèque perso : import par URL + grille avec photos.
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ImportRecipeForm } from "@/components/ImportRecipeForm";
import { RecipeCard } from "@/components/RecipeCard";

export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  const recipes = await db
    .select({
      id: schema.recipes.id,
      title: schema.recipes.title,
      imageUrl: schema.recipes.imageUrl,
    })
    .from(schema.recipes)
    .orderBy(desc(schema.recipes.createdAt));

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Mes recettes</h1>
      <ImportRecipeForm />
      {recipes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500 dark:border-stone-700">
          Aucune recette. Colle l’URL d’une recette que tu aimes, ou pige dans le catalogue.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {recipes.map((r) => (
            <li key={r.id}>
              <RecipeCard href={`/recettes/${r.id}`} title={r.title} imageUrl={r.imageUrl} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
