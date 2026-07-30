// /courses/[id] — LA liste d'épicerie, pensée téléphone en magasin : plein écran,
// grosses cibles tactiles, cochage optimiste.
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ShoppingChecklist } from "@/components/ShoppingChecklist";
import { ShoppingListEditor } from "@/components/ShoppingListEditor";
import { ShareListButton } from "@/components/ShareListButton";
import { ExportTasksButton } from "@/components/ExportTasksButton";

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

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Épicerie — {batch.name}</h1>
      <ExportTasksButton batchId={id} />
      <ShareListButton
        batchName={batch.name}
        items={items.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, checked: i.checked }))}
      />
      <ShoppingChecklist
        items={items.map((i) => ({
          id: i.id,
          name: i.name,
          qty: i.qty,
          unit: i.unit,
          estCost: i.estCost,
          checked: i.checked,
        }))}
      />
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
  );
}
