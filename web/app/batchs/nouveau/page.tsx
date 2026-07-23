// /batchs/nouveau — composer un batch : choisir des recettes + portions. Phase 1 :
// composition MANUELLE (pas d'algo de sélection) — c'est toi le chef.
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { NewBatchForm } from "@/components/NewBatchForm";

export const dynamic = "force-dynamic";

export default async function NewBatchPage() {
  const recipes = await db
    .select({
      id: schema.recipes.id,
      title: schema.recipes.title,
      servings: schema.recipes.servings,
    })
    .from(schema.recipes)
    .orderBy(desc(schema.recipes.createdAt));

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Nouveau batch</h1>
      <NewBatchForm recipes={recipes} />
    </div>
  );
}
