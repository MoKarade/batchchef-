// /catalogue — les 10 188 recettes Marmiton, cherchables. Source d'idées, séparée de
// ta bibliothèque perso.
import Link from "next/link";
import { and, ilike, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { CatalogueSearch } from "@/components/CatalogueSearch";
import { RecipeCard } from "@/components/RecipeCard";

export const dynamic = "force-dynamic";
const PAGE = 24;

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; p?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.p) || 1);
  const where = q ? ilike(schema.catalogRecipes.title, `%${q}%`) : undefined;

  const countRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.catalogRecipes)
    .where(where ? and(where) : undefined);
  const total = countRows[0]?.n ?? 0;
  const recipes = await db
    .select({
      id: schema.catalogRecipes.id,
      title: schema.catalogRecipes.title,
      imageUrl: schema.catalogRecipes.imageUrl,
    })
    .from(schema.catalogRecipes)
    .where(where ? and(where) : undefined)
    .orderBy(schema.catalogRecipes.id)
    .limit(PAGE)
    .offset((page - 1) * PAGE);

  const lastPage = Math.max(1, Math.ceil(total / PAGE));
  const qs = (p: number) => `/catalogue?${new URLSearchParams({ ...(q ? { q } : {}), p: String(p) })}`;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Catalogue de découverte</h1>
        <p className="mt-1 text-sm text-stone-500">
          {total.toLocaleString("fr-CA")} recettes — cherche une idée, ajoute-la à ta bibliothèque.
        </p>
      </div>
      <CatalogueSearch initial={q} />

      {recipes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500 dark:border-stone-700">
          {total === 0
            ? "Catalogue vide — lance l’import (npm run catalog:import) pour peupler les 10 188 recettes."
            : "Aucun résultat pour cette recherche."}
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {recipes.map((r) => (
              <li key={r.id}>
                <RecipeCard href={`/catalogue/${r.id}`} title={r.title} imageUrl={r.imageUrl} />
              </li>
            ))}
          </ul>
          {lastPage > 1 && (
            <div className="flex items-center justify-between text-sm">
              {page > 1 ? (
                <Link href={qs(page - 1)} className="rounded-lg border border-stone-300 px-3 py-2 dark:border-stone-700">
                  ← Précédent
                </Link>
              ) : (
                <span />
              )}
              <span className="text-stone-500">
                Page {page} / {lastPage.toLocaleString("fr-CA")}
              </span>
              {page < lastPage ? (
                <Link href={qs(page + 1)} className="rounded-lg border border-stone-300 px-3 py-2 dark:border-stone-700">
                  Suivant →
                </Link>
              ) : (
                <span />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
