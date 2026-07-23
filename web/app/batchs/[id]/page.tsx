// /batchs/[id] — récap d'un batch : recettes/portions, budget honnête, statut.
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
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
    })
    .from(schema.batchRecipes)
    .innerJoin(schema.recipes, eq(schema.recipes.id, schema.batchRecipes.recipeId))
    .where(eq(schema.batchRecipes.batchId, id));

  const items = await db
    .select()
    .from(schema.shoppingItems)
    .where(eq(schema.shoppingItems.batchId, id));

  const estimated = items.filter((i) => i.estCost !== null && i.costKind === "estime");
  const totalEstime = estimated.reduce((sum, i) => sum + (i.estCost ?? 0), 0);
  const unknownCount = items.length - estimated.length;
  const totalPortions = recipeRows.reduce((sum, r) => sum + r.portions, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">{batch.name}</h1>
        <p className="mt-1 text-sm text-stone-500">{totalPortions} portions au total</p>
      </div>

      <section>
        <h2 className="mb-2 font-semibold">Recettes</h2>
        <ul className="divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
          {recipeRows.map((r) => (
            <li key={r.recipeId} className="flex items-center justify-between px-4 py-3 text-sm">
              <Link href={`/recettes/${r.recipeId}`} className="underline-offset-2 hover:underline">
                {r.title}
              </Link>
              <span className="tabular-nums text-stone-600 dark:text-stone-400">
                {r.portions} portions
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <h2 className="font-semibold">Budget d’épicerie</h2>
        {estimated.length > 0 ? (
          <p className="mt-1 text-2xl font-bold tabular-nums">
            ≈ {totalEstime.toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
            <span className="ml-2 align-middle rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              estimé
            </span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-stone-500">Aucune estimation disponible.</p>
        )}
        <p className="mt-1 text-xs text-stone-500">
          {estimated.length} article(s) estimé(s)
          {unknownCount > 0 && ` · ${unknownCount} sans estimation`} · taxes exclues — les
          prix réels viendront de tes reçus (Phase 2).
        </p>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href={`/courses/${batch.id}`}
          className="flex-1 rounded-xl px-4 py-3 text-center font-medium text-white"
          style={{ backgroundColor: "var(--accent)" }}
        >
          Ouvrir la liste d’épicerie ({items.length})
        </Link>
        <BatchStatusControls batchId={batch.id} status={batch.status} />
      </div>
    </div>
  );
}
