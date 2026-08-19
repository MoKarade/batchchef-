// /courses/[id] — LA liste d'épicerie, pensée téléphone en magasin.
//
// ⚠️ ORDRE VOULU, et c'est le cœur de la refonte du 13/08/2026 : la LISTE d'abord, ses
// outils ensuite. Avant, quatre contrôles secondaires (export Google Tasks, dépliant de
// reconnexion, partage) s'empilaient AVANT la liste — au magasin, il fallait scroller pour
// atteindre la seule chose dont on ait besoin debout. L'export et le partage sont des
// gestes d'AVANT-départ ; ils n'ont rien à faire sur le chemin du geste quotidien.

import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { shoppingChecklistKey } from "@/lib/aggregate";
import { estIngredientDeFond, resumerIngredientsDeFond } from "@/lib/ingredientsDeFond";
import { ShoppingChecklist } from "@/components/ShoppingChecklist";
import { ShoppingListEditor } from "@/components/ShoppingListEditor";
import { ShareListButton } from "@/components/ShareListButton";
import { ExportTasksButton } from "@/components/ExportTasksButton";
import { ReconnectGoogleButton } from "@/components/AuthButtons";

export const dynamic = "force-dynamic";

export default async function ShoppingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  const [batch] = await db.select().from(schema.batches).where(eq(schema.batches.id, id));
  if (!batch) notFound();
  const items = await db
    .select()
    .from(schema.shoppingItems)
    .where(eq(schema.shoppingItems.batchId, id))
    .orderBy(asc(schema.shoppingItems.name));

  // Ce que la liste N'AFFICHE PAS et pourquoi. Sel, poivre et eau sont écartés à la création
  // du batch ; les recalculer ici depuis les recettes évite une colonne de plus, et surtout
  // évite un retrait SILENCIEUX — un article qui disparaît sans explication, c'est ce qui
  // fait douter du reste de la liste.
  const ingredientsDesRecettes = await db
    .select({ name: schema.recipeIngredients.name, canonical: schema.recipeIngredients.canonical })
    .from(schema.batchRecipes)
    .innerJoin(
      schema.recipeIngredients,
      eq(schema.recipeIngredients.recipeId, schema.batchRecipes.recipeId),
    )
    .where(eq(schema.batchRecipes.batchId, id));
  const noteDeFond = resumerIngredientsDeFond(
    ingredientsDesRecettes.filter((i) => estIngredientDeFond(i.canonical)).map((i) => i.name),
  );


  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm doux">Épicerie</p>
        <h1 className="text-2xl font-bold">{batch.name}</h1>
      </div>

      <ShoppingChecklist
        key={shoppingChecklistKey(items)}
        items={items.map((i) => ({
          id: i.id,
          name: i.name,
          qty: i.qty,
          unit: i.unit,
          estCost: i.estCost,
          checked: i.checked,
        }))}
      />


      {noteDeFond && <p className="text-xs doux">{noteDeFond}</p>}

      {/* Tout ce qui se fait AVANT de partir, replié sous un seul dépliant. */}
      <details className="carte overflow-hidden">
        <summary className="cursor-pointer px-4 py-3 font-medium">Outils de la liste</summary>
        <div className="space-y-4 border-t px-4 py-4" style={{ borderColor: "var(--bordure)" }}>
          <div className="space-y-2">
            <ExportTasksButton batchId={id} />
            <ShareListButton
              batchName={batch.name}
              items={items.map((i) => ({
                name: i.name,
                qty: i.qty,
                unit: i.unit,
                checked: i.checked,
              }))}
            />
            {/* Si Google Tasks répond « reconnecte-toi » : ce bouton accorde la permission. */}
            <details className="text-xs doux">
              <summary className="cursor-pointer py-1">
                Google Tasks demande de te reconnecter ?
              </summary>
              <div className="mt-2">
                <ReconnectGoogleButton redirectTo={`/courses/${id}`} />
              </div>
            </details>
          </div>

          <ShoppingListEditor
            batchId={id}
            items={items.map((i) => ({
              id: i.id,
              name: i.name,
              qty: i.qty,
              unit: i.unit,
              estCost: i.estCost,
            }))}
          />
        </div>
      </details>
    </div>
  );
}
