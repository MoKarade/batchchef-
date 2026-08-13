// /recettes — bibliothèque perso.
//
// ⚠️ ORDRE VOULU (refonte du 13/08/2026) : la BIBLIOTHÈQUE d'abord, les formulaires
// d'import ensuite, repliés. Les deux formulaires occupaient tout le haut de l'écran alors
// que la raison la plus fréquente d'ouvrir cette page est de RETROUVER une recette — et que
// le chemin d'import principal, désormais, est le partage Android qui arrive sur /partage.
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ImportRecipeForm } from "@/components/ImportRecipeForm";
import { ImportVideoForm } from "@/components/ImportVideoForm";
import { RecipeCard } from "@/components/RecipeCard";

export const dynamic = "force-dynamic";
// Les Server Actions de cette page enchaînent deux appels LLM (extraction + vérification) :
// le défaut de la plateforme couperait au milieu sur une vidéo.
export const maxDuration = 60;

export default async function RecipesPage() {
  const recipes = await db
    .select({
      id: schema.recipes.id,
      title: schema.recipes.title,
      imageUrl: schema.recipes.imageUrl,
    })
    .from(schema.recipes)
    .orderBy(desc(schema.recipes.createdAt));

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">Mes recettes</h1>
        {recipes.length > 0 && (
          <span className="text-sm tabular-nums doux">
            {recipes.length} recette{recipes.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      <details className="carte overflow-hidden">
        <summary className="cursor-pointer px-4 py-3 font-medium">Ajouter une recette</summary>
        <div className="space-y-4 border-t px-4 py-4" style={{ borderColor: "var(--bordure)" }}>
          <ImportRecipeForm />
          <ImportVideoForm transcriptionActive={Boolean(process.env.GROQ_API_KEY)} />
        </div>
      </details>

      {recipes.length === 0 ? (
        <p
          className="rounded-2xl border border-dashed p-6 text-center text-sm doux"
          style={{ borderColor: "var(--bordure)" }}
        >
          Aucune recette pour l’instant. Partage un enregistrement d’écran d’un reel vers
          BatchChef, colle l’URL d’une recette, ou pige dans le catalogue.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {recipes.map((r) => (
            <li key={r.id}>
              <RecipeCard href={`/recettes/${r.id}`} title={r.title} imageUrl={r.imageUrl} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
