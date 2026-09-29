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
      difficulte: schema.recipes.difficulteEstimee,
    })
    .from(schema.recipes)
    .orderBy(desc(schema.recipes.createdAt));

  return (
    <div>
      <header className="entete">
        <div>
          <p className="surtitre">Bibliothèque</p>
          <h1>Mes recettes</h1>
        </div>
        {recipes.length > 0 && (
          <span className="num doux">
            {recipes.length} recette{recipes.length > 1 ? "s" : ""}
          </span>
        )}
      </header>

      <details className="carte overflow-hidden">
        <summary className="flex min-h-11 cursor-pointer items-center px-5 font-semibold">
          Ajouter une recette
        </summary>
        <div className="space-y-4 border-t px-5 py-4" style={{ borderColor: "var(--bordure)" }}>
          <ImportRecipeForm />
          <ImportVideoForm transcriptionActive={Boolean(process.env.GROQ_API_KEY)} />
        </div>
      </details>

      {recipes.length === 0 ? (
        <div className="vide mt-6">
          <h2>Aucune recette pour l’instant</h2>
          <p>
            Partage un enregistrement d’écran d’un reel vers BatchChef, colle l’URL d’une
            recette, ou pige dans le catalogue.
          </p>
        </div>
      ) : (
        <ul className="grille g3 mt-6">
          {recipes.map((r) => (
            <li key={r.id}>
              <RecipeCard
                href={`/recettes/${r.id}`}
                title={r.title}
                imageUrl={r.imageUrl}
                difficulte={r.difficulte}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
