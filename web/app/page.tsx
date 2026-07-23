// / — accueil : l'état en un coup d'œil + les deux gestes principaux.
import Link from "next/link";
import { count, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";

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
            className="rounded-2xl border border-stone-200 bg-white p-4 text-center shadow-sm dark:border-stone-800 dark:bg-stone-900"
          >
            <div className="text-2xl font-bold tabular-nums">{s.value}</div>
            <div className="mt-1 text-xs text-stone-600 dark:text-stone-400">{s.label}</div>
          </Link>
        ))}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/recettes"
          className="flex-1 rounded-xl border border-stone-300 px-4 py-3 text-center font-medium dark:border-stone-700"
        >
          + Importer une recette
        </Link>
        <Link
          href="/batchs/nouveau"
          className="flex-1 rounded-xl px-4 py-3 text-center font-medium text-white"
          style={{ backgroundColor: "var(--accent)" }}
        >
          Nouveau batch
        </Link>
      </div>
      <p className="text-sm text-stone-500 dark:text-stone-400">
        Le cycle : importe tes recettes → compose un batch → fais l’épicerie avec la liste
        sur ton téléphone.
      </p>
    </div>
  );
}
