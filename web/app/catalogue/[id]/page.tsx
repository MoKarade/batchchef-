// /catalogue/[id] — détail d'une recette du catalogue + bouton « Ajouter à ma bibliothèque ».
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatQty } from "@/lib/aggregate";
import { AddToLibraryButton } from "@/components/AddToLibraryButton";
import { Durees } from "@/components/Durees";
import { ImageRecette } from "@/components/ImageRecette";

export const dynamic = "force-dynamic";

export default async function CatalogueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  const [recipe] = await db.select().from(schema.catalogRecipes).where(eq(schema.catalogRecipes.id, id));
  if (!recipe) notFound();
  const ingredients = await db
    .select()
    .from(schema.catalogIngredients)
    .where(eq(schema.catalogIngredients.catalogRecipeId, id));

  return (
    <article className="space-y-5">
      <Link href="/catalogue" className="text-sm underline">← Catalogue</Link>
      {recipe.imageUrl && (
         
        <ImageRecette src={recipe.imageUrl} className="aspect-video w-full rounded-2xl object-cover" />
      )}
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-xl font-bold">{recipe.title}</h1>
        <AddToLibraryButton catalogRecipeId={recipe.id} />
      </div>

      <Durees prep={recipe.prepMinutes} cuisson={recipe.cuissonMinutes} />

      <section>
        <h2 className="mb-2 font-semibold">Ingrédients (pour {recipe.servings} portion{recipe.servings > 1 ? "s" : ""})</h2>
        <ul className="divide-y divide-[var(--bordure)] rounded-2xl border border-[var(--bordure)] bg-[var(--surface)]">
          {ingredients.map((ing) => (
            <li key={ing.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>{ing.name}{ing.note && <span className="doux"> — {ing.note}</span>}</span>
              <span className="tabular-nums doux">{formatQty(ing.qty, ing.unit)}</span>
            </li>
          ))}
        </ul>
      </section>

      {recipe.instructions && (
        <section>
          <h2 className="mb-2 font-semibold">Préparation</h2>
          <p className="whitespace-pre-line rounded-2xl border border-[var(--bordure)] bg-[var(--surface)] p-4 text-sm leading-relaxed">
            {recipe.instructions}
          </p>
        </section>
      )}
      {recipe.sourceUrl && (
        <a href={recipe.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-block text-sm underline">
          Voir sur Marmiton →
        </a>
      )}
    </article>
  );
}
