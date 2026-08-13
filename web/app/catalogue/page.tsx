// /catalogue — les 10 188 recettes Marmiton, cherchables par titre OU par ingrédient
// (« gingembre » retrouve toute recette qui en contient, pas seulement dans le titre).
// Source d'idées, séparée de ta bibliothèque perso.
import Link from "next/link";
import { and, eq, exists, ilike, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { CatalogueSearch } from "@/components/CatalogueSearch";
import { CatalogueGrid } from "@/components/CatalogueGrid";

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

  // Un ingrédient de la recette contient q → EXISTS corrélé (pas de doublon même si
  // plusieurs ingrédients matchent, contrairement à un JOIN classique).
  const ingredientMatch = q
    ? exists(
        db
          .select({ x: sql`1` })
          .from(schema.catalogIngredients)
          .where(
            and(
              eq(schema.catalogIngredients.catalogRecipeId, schema.catalogRecipes.id),
              ilike(schema.catalogIngredients.name, `%${q}%`),
            ),
          ),
      )
    : undefined;
  const where = q ? or(ilike(schema.catalogRecipes.title, `%${q}%`), ingredientMatch) : undefined;

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
        <p className="mt-1 text-sm doux">
          {total.toLocaleString("fr-CA")} recettes — cherche par titre ou par ingrédient, ajoute une idée à ta
          bibliothèque.
        </p>
      </div>
      <CatalogueSearch initial={q} />

      {recipes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--bordure)] p-6 text-center text-sm doux ">
          {total === 0
            ? "Catalogue vide — lance l’import (npm run catalog:import) pour peupler les 10 188 recettes."
            : "Aucun résultat pour cette recherche."}
        </p>
      ) : (
        <>
          <p className="text-xs doux">
            Coche les recettes (coin des cartes) pour en ajouter plusieurs d’un coup à ta bibliothèque.
          </p>
          <CatalogueGrid recipes={recipes} />
          {lastPage > 1 && (
            <div className="flex items-center justify-between text-sm">
              {page > 1 ? (
                <Link href={qs(page - 1)} className="rounded-lg border border-[var(--bordure)] px-3 py-2 ">
                  ← Précédent
                </Link>
              ) : (
                <span />
              )}
              <span className="doux">
                Page {page} / {lastPage.toLocaleString("fr-CA")}
              </span>
              {page < lastPage ? (
                <Link href={qs(page + 1)} className="rounded-lg border border-[var(--bordure)] px-3 py-2 ">
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
