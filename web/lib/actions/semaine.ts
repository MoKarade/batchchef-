"use server";

// lib/actions/semaine.ts — proposition de la semaine (SEM-02, SEM-03) et son batch.
//
// Server Actions : chaque export est un point d'entrée appelable depuis le navigateur, et
// revérifie donc la session EN TÊTE (défense en profondeur : le middleware garde déjà).
// Jamais de fonction `*Interne` ici (faille M2) : elles vivent dans lib/actionsInternes/.
// Chaque échec est retourné comme message honnête, jamais avalé.

import { revalidatePath } from "next/cache";
import { inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatDateAjout } from "@/lib/origine";
import {
  apercuPlacement,
  placerRecette,
  regenererSemaine,
  remplacerPosition,
  semaineCourante,
  type ApercuPlacement,
} from "@/lib/semaineDb";
import { ajouterDuCatalogueInterne } from "@/lib/actionsInternes/catalogue";
import { creerBatchInterne } from "@/lib/actionsInternes/batch";
import { fail, type ActionResult } from "@/lib/actionsInternes/commun";
import { requireSession } from "@/lib/actionsInternes/session";

/**
 * Ce qu'une proposition de l'assistant ferait, avant de la faire (SEM-03). LECTURE seule.
 *
 * ⚠️ Elle sert à ÉCRIRE l'avertissement sur la carte : Marc doit voir qu'il s'apprête à
 * casser la composition « 3 plats + 1 dessert » AVANT de cliquer, puisque c'est son clic
 * qui vaut demande explicite.
 */
export async function apercuPlacementSemaine(
  place: number,
  catalogRecipeId: number,
): Promise<{ ok: true; apercu: ApercuPlacement } | { ok: false; error: string }> {
  try {
    await requireSession();
    const r = await apercuPlacement(place, catalogRecipeId);
    if ("erreur" in r) return { ok: false, error: r.erreur };
    return { ok: true, apercu: r };
  } catch (err) {
    // ⚠️ `fail` rend un `ActionResult` sans `apercu` : on reformule ici plutôt que d'élargir
    // le type de retour, sinon l'appelant devrait gérer un « ok sans aperçu » qui n'existe pas.
    const echec = fail(err);
    return { ok: false, error: echec.ok ? "Aperçu indisponible." : echec.error };
  }
}

/** Pose une recette précise à une place de la semaine (SEM-03). */
export async function placerRecetteSemaine(
  place: number,
  catalogRecipeId: number,
): Promise<ActionResult & { titre?: string }> {
  try {
    await requireSession();
    const r = await placerRecette(place, catalogRecipeId);
    if (!r.ok) return r;
    revalidatePath("/");
    return { ok: true, titre: r.titre };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Retire les quatre recettes de la semaine et en propose quatre autres.
 *
 * ⚠️ Irréversible au sens où l'ancienne proposition n'est pas conservée — Marc a choisi une
 * seule semaine vivante (SEM-02). L'écran demande donc une confirmation avant d'appeler :
 * un clic qui efface quatre choix faits un par un mérite un second geste.
 */
export async function regenererSemaineAction(): Promise<ActionResult & { recettes?: number }> {
  try {
    await requireSession();
    const r = await regenererSemaine();
    if (!r.ok) return r;
    revalidatePath("/");
    return { ok: true, recettes: r.recettes };
  } catch (err) {
    return fail(err);
  }
}

/** Remplace UNE des quatre recettes proposées. La règle de variété vit dans `semaineDb`. */
export async function remplacerRecetteSemaine(position: number): Promise<ActionResult> {
  try {
    await requireSession();
    const r = await remplacerPosition(position);
    if (!r.ok) return r;
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Monte le batch de la semaine à partir des quatre recettes proposées : copie du catalogue
 * vers la bibliothèque (idempotent), puis batch et liste d'épicerie.
 *
 * ⚠️ Les deux étapes passent par les fonctions de TRAVAIL de l'app
 * (`ajouterDuCatalogueInterne`, `creerBatchInterne`), jamais par du SQL réécrit ici : un
 * batch né de la semaine doit écarter le sel et estimer ses prix exactement comme un batch
 * composé à la main.
 */
export async function creerBatchDepuisSemaine(): Promise<ActionResult & { id?: number }> {
  try {
    await requireSession();
    const { recettes } = await semaineCourante();
    if (recettes.length === 0) return { ok: false, error: "Aucune proposition cette semaine." };

    const ids = recettes.map((r) => r.catalogRecipeId);
    const copie = await ajouterDuCatalogueInterne(ids);
    if (!copie.ok) return copie;

    // On retrouve les recettes de la bibliothèque par leur SOURCE, seul lien entre les deux
    // tables. Une recette du catalogue sans source ne peut pas être reliée — le catalogue
    // n'en porte aucune aujourd'hui, mais si ça changeait, mieux vaut le dire que monter un
    // batch amputé en silence.
    const sources = await db
      .select({ id: schema.catalogRecipes.id, sourceUrl: schema.catalogRecipes.sourceUrl })
      .from(schema.catalogRecipes)
      .where(inArray(schema.catalogRecipes.id, ids));
    const urls = sources.map((s) => s.sourceUrl).filter((u): u is string => u !== null);
    const miennes =
      urls.length === 0
        ? []
        : await db
            .select({
              id: schema.recipes.id,
              sourceUrl: schema.recipes.sourceUrl,
              servings: schema.recipes.servings,
            })
            .from(schema.recipes)
            .where(inArray(schema.recipes.sourceUrl, urls));

    const parSource = new Map(miennes.map((r) => [r.sourceUrl, r]));
    const selections: Array<{ recipeId: number; portions: number }> = [];
    const perdues: string[] = [];
    for (const r of recettes) {
      const url = sources.find((s) => s.id === r.catalogRecipeId)?.sourceUrl ?? null;
      const mienne = url ? parSource.get(url) : undefined;
      if (!mienne) {
        perdues.push(r.titre);
        continue;
      }
      selections.push({ recipeId: mienne.id, portions: mienne.servings });
    }
    if (perdues.length > 0) {
      return {
        ok: false,
        error: `Impossible de relier ${perdues.length} recette(s) à ta bibliothèque : ${perdues.join(", ")}.`,
      };
    }

    const batch = await creerBatchInterne({
      name: `Semaine du ${formatDateAjout(new Date())}`,
      selections,
    });
    if (!batch.ok) return batch;
    revalidatePath("/");
    revalidatePath("/batchs");
    return batch;
  } catch (err) {
    return fail(err);
  }
}
