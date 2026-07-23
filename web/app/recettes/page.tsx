// /recettes — bibliothèque perso : import par URL + liste.
import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ImportRecipeForm } from "@/components/ImportRecipeForm";

export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  const recipes = await db
    .select()
    .from(schema.recipes)
    .orderBy(desc(schema.recipes.createdAt));

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Mes recettes</h1>
      <ImportRecipeForm />
      {recipes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500 dark:border-stone-700">
          Aucune recette. Colle l’URL d’une recette que tu aimes pour commencer.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {recipes.map((r) => (
            <li key={r.id}>
              <Link
                href={`/recettes/${r.id}`}
                className="flex h-full flex-col rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900"
              >
                <span className="font-medium">{r.title}</span>
                <span className="mt-1 text-xs text-stone-500">
                  {r.servings} portions de référence
                  {r.sourceUrl ? ` · ${new URL(r.sourceUrl).hostname}` : " · saisie manuelle"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
