// /catalogue — les 10 188 recettes Marmiton, cherchables par titre OU par ingrédient
// (« gingembre » retrouve toute recette qui en contient, pas seulement dans le titre).
// Source d'idées, séparée de ta bibliothèque perso.
import Link from "next/link";
import { and, eq, exists, ilike, or, sql } from "drizzle-orm";
import { normaliserPourRecherche } from "@/lib/rechercheNormalisee";
import { db, schema } from "@/lib/db";
import { CatalogueSearch } from "@/components/CatalogueSearch";
import { CatalogueGrid } from "@/components/CatalogueGrid";
import { FiltreType, TYPE_INCONNU } from "@/components/FiltreType";
import { estTypePlat } from "@/lib/typePlat";

export const dynamic = "force-dynamic";
const PAGE = 24;

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; p?: string; type?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.p) || 1);
  // ⚠️ Une valeur de type inconnue est IGNORÉE, jamais transformée en filtre vide : « ?type=
  // gouter » doit rendre le catalogue entier, pas zéro résultat sans explication.
  const typeDemande =
    sp.type === TYPE_INCONNU ? TYPE_INCONNU : estTypePlat(sp.type) ? sp.type : null;

  // Un ingrédient de la recette contient q → EXISTS corrélé (pas de doublon même si
  // plusieurs ingrédients matchent, contrairement à un JOIN classique).
  // ⚠️ On compare les colonnes NORMALISÉES, jamais le texte brut : « creme » ne trouvait
  // qu'UNE recette sur 346, et « d'ail » au clavier droit n'en trouvait aucune, les noms
  // portant l'apostrophe typographique. La requête passe par la MÊME règle que la colonne
  // générée (cf. lib/rechercheNormalisee.ts).
  const qn = normaliserPourRecherche(q);
  const ingredientMatch = qn
    ? exists(
        db
          .select({ x: sql`1` })
          .from(schema.catalogIngredients)
          .where(
            and(
              eq(schema.catalogIngredients.catalogRecipeId, schema.catalogRecipes.id),
              ilike(schema.catalogIngredients.nomRecherche, `%${qn}%`),
            ),
          ),
      )
    : undefined;
  const recherche = qn ? or(ilike(schema.catalogRecipes.titreRecherche, `%${qn}%`), ingredientMatch) : undefined;
  // Le type AFFICHÉ est la correction de Marc si elle existe, sinon l'estimation — le filtre
  // doit donc porter sur le même calcul, sinon une recette corrigée resterait introuvable
  // sous sa nouvelle famille. `COALESCE` sur la jointure fait exactement ça.
  const typeEffectifSql = sql`coalesce(${schema.typeCorrections.type}, ${schema.catalogRecipes.typeEstime})`;
  const filtreType =
    typeDemande === null
      ? undefined
      : typeDemande === TYPE_INCONNU
        ? sql`${typeEffectifSql} is null`
        : sql`${typeEffectifSql} = ${typeDemande}`;
  const where =
    recherche && filtreType ? and(recherche, filtreType) : (recherche ?? filtreType ?? undefined);

  const countRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.catalogRecipes)
    .leftJoin(schema.typeCorrections, eq(schema.typeCorrections.sourceUrl, schema.catalogRecipes.sourceUrl))
    .where(where ? and(where) : undefined);
  const total = countRows[0]?.n ?? 0;
  const recipes = await db
    .select({
      id: schema.catalogRecipes.id,
      title: schema.catalogRecipes.title,
      imageUrl: schema.catalogRecipes.imageUrl,
      difficulte: schema.catalogRecipes.difficulteEstimee,
    })
    .from(schema.catalogRecipes)
    .leftJoin(schema.typeCorrections, eq(schema.typeCorrections.sourceUrl, schema.catalogRecipes.sourceUrl))
    .where(where ? and(where) : undefined)
    .orderBy(schema.catalogRecipes.id)
    .limit(PAGE)
    .offset((page - 1) * PAGE);

  const lastPage = Math.max(1, Math.ceil(total / PAGE));
  const qs = (p: number) =>
    `/catalogue?${new URLSearchParams({
      ...(q ? { q } : {}),
      ...(typeDemande ? { type: typeDemande } : {}),
      p: String(p),
    })}`;

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
      <FiltreType actif={typeDemande} />

      {recipes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--bordure)] p-6 text-center text-sm doux">
          {total === 0
            ? "Catalogue vide — lance l’import (npm run catalog:import) pour peupler les 10 188 recettes."
            : typeDemande
              ? "Aucun résultat avec ce type. Le classement est une estimation : essaie « Non déterminé »."
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
                <Link href={qs(page - 1)} className="rounded-lg border border-[var(--bordure)] px-3 py-2">
                  ← Précédent
                </Link>
              ) : (
                <span />
              )}
              <span className="doux">
                Page {page} / {lastPage.toLocaleString("fr-CA")}
              </span>
              {page < lastPage ? (
                <Link href={qs(page + 1)} className="rounded-lg border border-[var(--bordure)] px-3 py-2">
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
