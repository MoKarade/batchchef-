"use server";

// lib/actions/import.ts — import d'une recette (page web, vidéo) puis enregistrement validé.
//
// Server Actions : chaque export est un point d'entrée appelable depuis le navigateur, et
// revérifie donc la session EN TÊTE (défense en profondeur : le middleware garde déjà).
// Jamais de fonction `*Interne` ici (faille M2) : elles vivent dans lib/actionsInternes/.
// Chaque échec est retourné comme message honnête, jamais avalé.

import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { telechargerPagePublique } from "@/lib/urlPublique";
import { MAX_TRANSCRIPT_CHARS } from "@/lib/transcription";
import { estOrigine, type OrigineRecette } from "@/lib/origine";
import {
  clampServings,
  normaliserImage,
  normaliserLienSource,
  prepareIngredientRows,
  type EditableIngredient,
} from "@/lib/recipeEdit";
import {
  MAX_CAPTION_CHARS,
  htmlToText,
  parseRecipeFromMedia,
  parseRecipeFromPage,
  verifyParsedRecipe,
  verifyRecipeAgainstCaption,
  type ParsedRecipe,
} from "@/lib/llm";
import {
  MAX_CAPTURES,
  MAX_FRAMES,
  MAX_TOTAL_BASE64_BYTES,
  base64Bytes,
  isLikelyBase64,
} from "@/lib/video/frames";
import { fail, type ActionResult } from "@/lib/actionsInternes/commun";
import { requireSession } from "@/lib/actionsInternes/session";

export interface RecipePreview {
  title: string;
  /** URL d'origine ; null pour une vidéo déposée sans lien. */
  sourceUrl: string | null;
  /** D'où vient la recette — porté jusqu'à l'enregistrement (cf. lib/origine.ts). */
  origine: OrigineRecette;
  imageUrl: string | null;
  servings: number;
  /** `true` = la source n'annonçait aucune portion, 4 est un défaut à corriger (pas une donnée). */
  servingsGuessed: boolean;
  instructions: string | null;
  ingredients: Array<{ name: string; qty: number | null; unit: "g" | "ml" | "unite" | null; note: string | null }>;
}

/**
 * Étape 1 de l'import : télécharge la page, parse (LLM) PUIS re-vérifie quantités/portions
 * (2ᵉ passe LLM). Ne sauvegarde RIEN — retourne l'extraction pour validation manuelle avant
 * enregistrement (Marc a le dernier mot sur chaque valeur).
 */
export async function parseRecipePreview(
  url: string,
): Promise<ActionResult & { recipe?: RecipePreview }> {
  try {
    await requireSession();
    const parsed = new URL(url); // valide le format
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { ok: false, error: "URL http(s) uniquement." };
    }
    // Garde SSRF : hôtes internes/privés refusés, redirections revérifiées, corps borné.
    const page = await telechargerPagePublique(url, {
      userAgent: "Mozilla/5.0 (BatchChef; +recette perso)",
    });
    if (!page.ok) return { ok: false, error: `Page injoignable (HTTP ${page.status}).` };

    const text = htmlToText(page.texte);
    const draft = await parseRecipeFromPage(text);
    const recipe = await verifyParsedRecipe(text, draft); // analyse plus poussée avant validation

    return { ok: true, recipe: toPreview(recipe, url, "page") };
  } catch (err) {
    return fail(err);
  }
}

/** Projette une recette parsée vers l'écran de validation (une seule conversion, partagée). */
function toPreview(
  recipe: ParsedRecipe,
  sourceUrl: string | null,
  origine: OrigineRecette,
): RecipePreview {
  return {
    title: recipe.title,
    sourceUrl,
    origine,
    imageUrl: recipe.imageUrl,
    servings: recipe.servings,
    servingsGuessed: recipe.servingsGuessed,
    instructions: recipe.instructions,
    ingredients: recipe.ingredients.map((i) => ({
      name: i.name,
      qty: i.qty,
      unit: i.unit,
      note: i.note,
    })),
  };
}

/**
 * Import depuis une VIDÉO (Instagram & co) : images extraites dans le navigateur + description
 * collée par Marc. Comme l'import par URL, ça ne sauvegarde RIEN — l'extraction part à l'écran
 * de validation, seul ce que Marc confirme entre en base.
 *
 * Le fichier vidéo lui-même n'arrive jamais ici : seules les images réduites transitent.
 * L'app ne va RIEN chercher chez Instagram (pas de scraping — cf. docs/claude/01-principes.md) : c'est Marc qui
 * fournit le contenu auquel il a accès, et le lien ne sert que de source affichée.
 */
export async function parseRecipeFromVideo(input: {
  frames: string[];
  captures?: string[];
  caption: string;
  /** Transcription de la bande sonore — source d'APPOINT, jamais prioritaire. */
  transcript?: string;
  sourceUrl: string | null;
}): Promise<ActionResult & { recipe?: RecipePreview }> {
  try {
    await requireSession();

    const frames = Array.isArray(input.frames) ? input.frames : [];
    const captures = Array.isArray(input.captures) ? input.captures : [];
    const caption = (input.caption ?? "").trim().slice(0, MAX_CAPTION_CHARS);

    // La transcription seule ne suffit PAS à lancer une extraction : sans écrit ni image,
    // toute quantité viendrait d'une reconnaissance vocale non vérifiable.
    if (frames.length === 0 && captures.length === 0 && caption.length === 0) {
      return {
        ok: false,
        error: "Donne au moins la vidéo, une capture d'écran ou la description.",
      };
    }
    // Gardes de taille : la plateforme rejette une requête trop grosse AVANT notre code —
    // autant échouer ici avec un message qui dit quoi faire.
    if (frames.length > MAX_FRAMES) {
      return { ok: false, error: `Trop d'images (${frames.length} > ${MAX_FRAMES}).` };
    }
    if (captures.length > MAX_CAPTURES) {
      return { ok: false, error: `Trop de captures d'écran (${captures.length} > ${MAX_CAPTURES}).` };
    }
    if (![...frames, ...captures].every((f) => typeof f === "string" && isLikelyBase64(f))) {
      return { ok: false, error: "Images illisibles : reprends l'analyse." };
    }
    const total = [...frames, ...captures].reduce((sum, f) => sum + base64Bytes(f), 0);
    if (total > MAX_TOTAL_BASE64_BYTES) {
      return { ok: false, error: "Images trop lourdes : réduis le nombre de captures ou la durée." };
    }

    let sourceUrl: string | null = null;
    if (input.sourceUrl && input.sourceUrl.trim()) {
      const parsed = new URL(input.sourceUrl.trim()); // format invalide → catch
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { ok: false, error: "Lien http(s) uniquement." };
      }
      sourceUrl = parsed.toString();
    }

    const transcript = (input.transcript ?? "").trim().slice(0, MAX_TRANSCRIPT_CHARS);
    const draft = await parseRecipeFromMedia({ frames, captures, caption, transcript });
    // 2ᵉ passe seulement s'il y a une description à confronter : sans texte, il n'y a rien
    // à vérifier, et une passe supplémentaire ne ferait qu'inventer de l'assurance.
    const recipe = caption ? await verifyRecipeAgainstCaption(caption, draft) : draft;

    return { ok: true, recipe: toPreview(recipe, sourceUrl, "video") };
  } catch (err) {
    return fail(err);
  }
}

/** Étape 2 de l'import : enregistre la recette VALIDÉE/corrigée par Marc. */
export async function saveImportedRecipe(input: {
  title: string;
  sourceUrl: string | null;
  /** Origine déclarée par le client — revérifiée ici, jamais prise pour argent comptant. */
  origine?: string | null;
  imageUrl: string | null;
  servings: number;
  instructions: string | null;
  ingredients: EditableIngredient[];
}): Promise<ActionResult & { id?: number }> {
  try {
    await requireSession();
    const title = input.title.trim();
    if (!title) return { ok: false, error: "Donne un titre à la recette." };
    const servings = clampServings(input.servings);
    const rows = prepareIngredientRows(input.ingredients);
    if (rows.length === 0) return { ok: false, error: "Garde au moins un ingrédient (avec un nom)." };

    // Le lien est ÉDITABLE à l'écran de validation : il n'a donc plus été filtré par le
    // chemin d'import qui le validait en amont. Sans cette garde, un « javascript:… »
    // deviendrait un <a href> exécutable sur la page de recette.
    const source = normaliserLienSource(input.sourceUrl);
    if (!source.valide) return { ok: false, error: "Lien de la source : http(s) uniquement." };

    const [row] = await db
      .insert(schema.recipes)
      .values({
        title,
        sourceUrl: source.lien,
        // Une valeur inconnue devient NULL (« origine non enregistrée ») plutôt que d'être
        // écrite telle quelle : l'affichage ne doit jamais attribuer à Marc une recette
        // dont on ne sait rien.
        origine: estOrigine(input.origine) ? input.origine : null,
        // Photo : http(s) d'un site, ou vignette embarquée tirée de la vidéo. Bornée et
        // filtrée ici — elle devient un <img src> sur la page de recette.
        imageUrl: normaliserImage(input.imageUrl),
        servings,
        instructions: input.instructions,
      })
      .returning({ id: schema.recipes.id });
    if (!row) return { ok: false, error: "Insertion de la recette échouée." };

    await db.insert(schema.recipeIngredients).values(
      rows.map((r) => ({
        recipeId: row.id,
        name: r.name,
        canonical: r.canonical,
        qty: r.qty,
        unit: r.unit,
        note: r.note,
      })),
    );

    revalidatePath("/recettes");
    return { ok: true, id: row.id };
  } catch (err) {
    return fail(err);
  }
}
