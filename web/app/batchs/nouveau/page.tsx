// /batchs/nouveau — composer un batch : choisir des recettes + portions. Phase 1 :
// composition MANUELLE (pas d'algo de sélection) — c'est toi le chef.
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { NewBatchForm } from "@/components/NewBatchForm";
import { portionsInitiales } from "@/lib/portionsInitiales";

export const dynamic = "force-dynamic";

export default async function NewBatchPage({
  searchParams,
}: {
  searchParams: Promise<{ recette?: string }>;
}) {
  const sp = await searchParams;
  const recipes = await db
    .select({
      id: schema.recipes.id,
      title: schema.recipes.title,
      servings: schema.recipes.servings,
    })
    .from(schema.recipes)
    .orderBy(desc(schema.recipes.createdAt));

  return (
    <div>
      <header className="entete">
        <div>
          <p className="surtitre">Batchs</p>
          <h1>Nouveau batch</h1>
        </div>
      </header>
      <NewBatchForm recipes={recipes} initial={portionsInitiales(recipes, sp.recette)} />
    </div>
  );
}
