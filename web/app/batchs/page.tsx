// /batchs — liste des batchs, statut, accès à la liste de courses.
import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  planifie: "Planifié",
  courses: "Courses",
  cuisine: "Cuisine",
  termine: "Terminé",
};

export default async function BatchesPage() {
  const batches = await db.select().from(schema.batches).orderBy(desc(schema.batches.createdAt));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Batchs</h1>
        <Link
          href="/batchs/nouveau"
          className="rounded-xl px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: "var(--accent)" }}
        >
          + Nouveau
        </Link>
      </div>
      {batches.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500 dark:border-stone-700">
          Aucun batch. Importe des recettes puis compose ton premier batch.
        </p>
      ) : (
        <ul className="space-y-3">
          {batches.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"
            >
              <Link href={`/batchs/${b.id}`} className="min-w-0 flex-1">
                <span className="font-medium">{b.name}</span>
                <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-400">
                  {STATUS_LABEL[b.status] ?? b.status}
                </span>
              </Link>
              <Link href={`/courses/${b.id}`} className="ml-3 shrink-0 text-sm underline">
                Liste
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
