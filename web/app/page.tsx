// / — accueil : l'état en un coup d'œil, les deux gestes principaux, et tes recettes récentes.
import Link from "next/link";
import { count, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { RecipeCard } from "@/components/RecipeCard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [recipeCount] = await db.select({ n: count() }).from(schema.recipes);
  const [activeBatches] = await db
    .select({ n: count() })
    .from(schema.batches)
    .where(inArray(schema.batches.status, ["planifie", "courses", "cuisine"]));
  const [toBuy] = await db
    .select({ n: count() })
    .from(schema.shoppingItems)
    .where(eq(schema.shoppingItems.checked, false));
  const recent = await db
    .select({
      id: schema.recipes.id,
      title: schema.recipes.title,
      imageUrl: schema.recipes.imageUrl,
    })
    .from(schema.recipes)
    .orderBy(desc(schema.recipes.createdAt))
    .limit(6);

  const stats = [
    { label: "Recettes", value: recipeCount?.n ?? 0, href: "/recettes" },
    { label: "Batchs actifs", value: activeBatches?.n ?? 0, href: "/batchs" },
    { label: "Articles à acheter", value: toBuy?.n ?? 0, href: "/batchs" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-2xl border border-[var(--bordure)] bg-[var(--surface)] p-4 text-center shadow-sm"
          >
            <div className="text-2xl font-bold tabular-nums">{s.value}</div>
            <div className="mt-1 text-xs doux">{s.label}</div>
          </Link>
        ))}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/recettes"
          className="flex-1 rounded-xl border border-[var(--bordure)] px-4 py-3 text-center font-medium"
        >
          + Importer une recette
        </Link>
        <Link
          href="/batchs/nouveau"
          className="bouton bouton-principal flex-1"
        >
          Nouveau batch
        </Link>
      </div>

      {recent.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recettes récentes</h2>
            <Link href="/recettes" className="text-sm underline">
              Tout voir
            </Link>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {recent.map((r) => (
              <li key={r.id}>
                <RecipeCard href={`/recettes/${r.id}`} title={r.title} imageUrl={r.imageUrl} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm doux">
          Le cycle : importe tes recettes → compose un batch → fais l’épicerie avec la liste
          sur ton téléphone.
        </p>
      )}
    </div>
  );
}
