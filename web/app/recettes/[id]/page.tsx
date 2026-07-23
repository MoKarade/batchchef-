// /recettes/[id] — détail d'une recette : ingrédients normalisés + instructions.
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatQty } from "@/lib/aggregate";
import { DeleteRecipeButton } from "@/components/DeleteRecipeButton";

export const dynamic = "force-dynamic";

export default async function RecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  const [recipe] = await db.select().from(schema.recipes).where(eq(schema.recipes.id, id));
  if (!recipe) notFound();
  const ingredients = await db
    .select()
    .from(schema.recipeIngredients)
    .where(eq(schema.recipeIngredients.recipeId, id));

  return (
    <article className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{recipe.title}</h1>
          <p className="mt-1 text-sm text-stone-500">
            {recipe.servings} portions de référence
            {recipe.sourceUrl && (
              <>
                {" · "}
                <a href={recipe.sourceUrl} target="_blank" rel="noreferrer noopener" className="underline">
                  source
                </a>
              </>
            )}
          </p>
        </div>
        <DeleteRecipeButton recipeId={recipe.id} />
      </div>

      <section>
        <h2 className="mb-2 font-semibold">Ingrédients</h2>
        <ul className="divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
          {ingredients.map((ing) => (
            <li key={ing.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>
                {ing.name}
                {ing.note && <span className="text-stone-500"> — {ing.note}</span>}
              </span>
              <span className="tabular-nums text-stone-600 dark:text-stone-400">
                {formatQty(ing.qty, ing.unit)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {recipe.instructions && (
        <section>
          <h2 className="mb-2 font-semibold">Préparation</h2>
          <p className="whitespace-pre-line rounded-2xl border border-stone-200 bg-white p-4 text-sm leading-relaxed dark:border-stone-800 dark:bg-stone-900">
            {recipe.instructions}
          </p>
        </section>
      )}

      <Link href="/batchs/nouveau" className="inline-block text-sm underline">
        → Composer un batch avec cette recette
      </Link>
    </article>
  );
}
