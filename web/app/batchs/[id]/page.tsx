// /batchs/[id] — récap d'un batch : recettes à cuisiner (quantités AJUSTÉES aux portions
// du batch), budget honnête, avancement du statut.
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatQty, scaleQty } from "@/lib/aggregate";
import { BatchStatusControls } from "@/components/BatchStatusControls";

export const dynamic = "force-dynamic";

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  const [batch] = await db.select().from(schema.batches).where(eq(schema.batches.id, id));
  if (!batch) notFound();

  const recipeRows = await db
    .select({
      portions: schema.batchRecipes.portions,
      recipeId: schema.batchRecipes.recipeId,
      title: schema.recipes.title,
      servings: schema.recipes.servings,
      instructions: schema.recipes.instructions,
    })
    .from(schema.batchRecipes)
    .innerJoin(schema.recipes, eq(schema.recipes.id, schema.batchRecipes.recipeId))
    .where(eq(schema.batchRecipes.batchId, id));

  const recipeIds = recipeRows.map((r) => r.recipeId);
  const ingredientRows = recipeIds.length
    ? await db
        .select()
        .from(schema.recipeIngredients)
        .where(inArray(schema.recipeIngredients.recipeId, recipeIds))
    : [];

  const items = await db
    .select()
    .from(schema.shoppingItems)
    .where(eq(schema.shoppingItems.batchId, id));

  // Distinguer « terminé sans stock enregistré » (batchs d'avant cette fonctionnalité) de
  // « terminé et rangé » : afficher « 0 portion » dans le premier cas serait un mensonge.
  const portionsRangees = await db
    .select({ id: schema.portions.id })
    .from(schema.portions)
    .where(eq(schema.portions.batchId, id));

  const totalCost = items.reduce((sum, i) => sum + (i.estCost ?? 0), 0);
  const totalPortions = recipeRows.reduce((sum, r) => sum + r.portions, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">{batch.name}</h1>
        <p className="mt-1 text-sm doux">{totalPortions} portions au total</p>
      </div>

      <section>
        <h2 className="mb-2 font-semibold">Recettes à cuisiner</h2>
        <p className="mb-2 text-xs doux">
          Quantités ajustées aux portions choisies pour ce batch. Touche une recette pour la déplier.
        </p>
        <ul className="space-y-2">
          {recipeRows.map((r) => {
            const ings = ingredientRows.filter((i) => i.recipeId === r.recipeId);
            return (
              <li
                key={r.recipeId}
                className="overflow-hidden carte"
              >
                <details>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1 font-medium">{r.title}</span>
                    <span className="shrink-0 tabular-nums text-sm doux">
                      {r.portions} portions
                    </span>
                  </summary>
                  <div className="border-t border-[var(--bordure)] px-4 py-3">
                    <ul className="divide-y divide-[var(--bordure)]">
                      {ings.map((ing) => (
                        <li key={ing.id} className="flex items-center justify-between py-2 text-sm">
                          <span>
                            {ing.name}
                            {ing.note && <span className="doux"> — {ing.note}</span>}
                          </span>
                          <span className="tabular-nums doux">
                            {formatQty(scaleQty(ing.qty, ing.unit, r.portions, r.servings), ing.unit)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {r.instructions && (
                      <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">
                        {r.instructions}
                      </p>
                    )}
                    <Link
                      href={`/recettes/${r.recipeId}`}
                      className="mt-3 inline-block text-sm underline"
                    >
                      Fiche recette (portions de référence) →
                    </Link>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="carte p-4">
        <h2 className="font-semibold">Budget d’épicerie</h2>
        <p className="mt-1 text-2xl font-bold tabular-nums">
          {totalCost.toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
        </p>
        <p className="mt-1 text-xs doux">
          {items.length} article(s) · taxes exclues.
        </p>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href={`/courses/${batch.id}`}
          className="bouton bouton-principal flex-1"
        >
          Ouvrir la liste d’épicerie ({items.length})
        </Link>
      </div>

      <BatchStatusControls
        batchId={batch.id}
        status={batch.status}
        recettes={recipeRows.map((r) => ({
          recipeId: r.recipeId,
          titre: r.title,
          portions: r.portions,
        }))}
        dejaRange={portionsRangees.length > 0}
      />
    </div>
  );
}
