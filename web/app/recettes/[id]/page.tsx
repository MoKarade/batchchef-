// /recettes/[id] — détail d'une recette : ingrédients normalisés + instructions.
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { DeleteRecipeButton } from "@/components/DeleteRecipeButton";
import { RecipeEditor } from "@/components/RecipeEditor";
import { ajouteeParMarc, formatDateAjout, libelleOrigine } from "@/lib/origine";

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
      {recipe.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={recipe.imageUrl} alt="" className="aspect-video w-full rounded-2xl object-cover" />
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{recipe.title}</h1>
          {/* D'où vient cette recette : la bibliothèque mélange ce que Marc a apporté et
              ce qu'il a pioché dans le catalogue de 10 188 recettes. Une origine absente
              (recettes antérieures à la colonne) se DIT, elle ne se devine pas. */}
          <p className="mt-1 text-sm doux">
            {libelleOrigine(recipe.origine)}
            {" · "}
            <time dateTime={recipe.createdAt.toISOString()}>
              {formatDateAjout(recipe.createdAt)}
            </time>
            {recipe.sourceUrl && (
              <>
                {" · "}
                <a
                  href={recipe.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline"
                >
                  {ajouteeParMarc(recipe.origine) ? "revoir la source" : "source"}
                </a>
              </>
            )}
          </p>
        </div>
        <DeleteRecipeButton recipeId={recipe.id} />
      </div>

      <RecipeEditor
        recipeId={recipe.id}
        servings={recipe.servings}
        ingredients={ingredients.map((ing) => ({
          name: ing.name,
          qty: ing.qty,
          unit: ing.unit,
          note: ing.note,
        }))}
      />

      {recipe.instructions && (
        <section>
          <h2 className="mb-2 font-semibold">Préparation</h2>
          <p className="whitespace-pre-line rounded-2xl border border-[var(--bordure)] bg-white p-4 text-sm leading-relaxed  ">
            {recipe.instructions}
          </p>
        </section>
      )}

      {/* Le geste qui SUIT une recette : un lien souligné se confondait avec le reste. */}
      <Link href="/batchs/nouveau" className="bouton bouton-second w-full">
        Composer un batch avec cette recette
      </Link>
    </article>
  );
}
