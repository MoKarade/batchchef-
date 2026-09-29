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

  const totalCost = items.reduce((sum, i) => sum + (i.estCost ?? 0), 0);
  const totalPortions = recipeRows.reduce((sum, r) => sum + r.portions, 0);

  return (
    <div className="space-y-8">
      <header className="entete !mb-0">
        <div>
          <p className="surtitre">Batchs</p>
          <h1>{batch.name}</h1>
          <p className="doux num mt-1">{totalPortions} portions au total</p>
        </div>
        <div className="ligne">
          <Link href={`/courses/${batch.id}`} className="bouton bouton-second">
            Liste d’épicerie ({items.length})
          </Link>
        </div>
      </header>

      <section>
        <h2 className="mb-3 text-xl font-bold">Recettes à cuisiner</h2>
        <p className="doux mb-3 text-sm">
          Quantités ajustées aux portions choisies pour ce batch. Touche une recette pour la déplier.
        </p>
        <ul className="pile">
          {recipeRows.map((r) => {
            const ings = ingredientRows.filter((i) => i.recipeId === r.recipeId);
            return (
              <li
                key={r.recipeId}
                className="overflow-hidden carte"
              >
                <details>
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1 text-base font-bold">{r.title}</span>
                    <span className="shrink-0 num text-sm doux">
                      {r.portions} portions
                    </span>
                  </summary>
                  <div className="border-t border-[var(--bordure)] px-5 py-3">
                    <ul className="liste !border-0 !rounded-none">
                      {ings.map((ing) => (
                        <li key={ing.id} className="flex items-center justify-between gap-3 py-2 text-sm">
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
                      className="bouton bouton-second mt-3"
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

      <section className="tuile" aria-labelledby="budget">
        <h2 id="budget" className="tuile-lib">
          Budget d’épicerie
        </h2>
        <p className="tuile-val">
          {totalCost.toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
        </p>
        <p className="doux mt-1 text-sm">{items.length} article(s) · taxes exclues.</p>
      </section>

      {/* Avancement + suppression : en bas, comme avant la refonte — « Supprimer » ne doit pas
          s'intercaler entre l'en-tête et les recettes. */}
      <BatchStatusControls batchId={batch.id} status={batch.status} />
    </div>
  );
}
