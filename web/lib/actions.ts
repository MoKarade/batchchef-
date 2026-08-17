"use server";

// lib/actions.ts — Server Actions de la Phase 1. Toute écriture revérifie la session
// côté serveur (défense en profondeur : le middleware garde déjà, mais les actions
// portent les écritures). Chaque échec est retourné comme message honnête, jamais avalé.

import { revalidatePath } from "next/cache";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { aggregateShoppingList, fillMissingCosts, shoppingTitles } from "@/lib/aggregate";
import { upsertTaskList } from "@/lib/googleTasks";
import { splitNewCatalogRecipes } from "@/lib/catalogSelect";
import { MAX_TRANSCRIPT_CHARS } from "@/lib/transcription";
import { estOrigine, type OrigineRecette } from "@/lib/origine";
import { validerRangements, type RangementBrut } from "@/lib/portions";
import { validerAjoutGardeManger } from "@/lib/gardeManger";
import {
  clampServings,
  normaliserImage,
  normaliserLienSource,
  prepareIngredientRows,
  type EditableIngredient,
} from "@/lib/recipeEdit";
import {
  MAX_CAPTION_CHARS,
  estimateShoppingCosts,
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

async function requireSession(): Promise<void> {
  const session = await auth();
  if (!session) throw new Error("Session requise.");
}

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(err: unknown): ActionResult {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/** Violation de contrainte FK Postgres (code 23503) — cf. NeonDbError. */
function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "23503";
}

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
    const page = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (BatchChef; +recette perso)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!page.ok) return { ok: false, error: `Page injoignable (HTTP ${page.status}).` };

    const text = htmlToText(await page.text());
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
 * L'app ne va RIEN chercher chez Instagram (pas de scraping — cf. CLAUDE.md) : c'est Marc qui
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

/**
 * Ajoute EN MASSE des recettes du catalogue à la bibliothèque perso. Idempotent sur la
 * source : une recette déjà présente (même sourceUrl) est ignorée, jamais dupliquée.
 * Retourne le nombre réellement ajouté et le nombre ignoré (déjà présent) — compte honnête.
 */
export async function addCatalogRecipesToLibrary(
  catalogRecipeIds: number[],
): Promise<ActionResult & { added?: number; skipped?: number }> {
  try {
    await requireSession();
    const ids = [...new Set(catalogRecipeIds)].filter((id) => Number.isInteger(id));
    if (ids.length === 0) return { ok: false, error: "Aucune recette sélectionnée." };

    const cats = await db.select().from(schema.catalogRecipes).where(inArray(schema.catalogRecipes.id, ids));
    if (cats.length === 0) return { ok: false, error: "Recettes du catalogue introuvables." };

    // Dédoublonnage sur la source : on ne réajoute pas ce qui est déjà dans la bibliothèque.
    const existing = await db.select({ sourceUrl: schema.recipes.sourceUrl }).from(schema.recipes);
    const { toAdd, skipped } = splitNewCatalogRecipes(
      cats.map((c) => ({ id: c.id, sourceUrl: c.sourceUrl })),
      existing.map((r) => r.sourceUrl).filter((u): u is string => u !== null),
    );
    if (toAdd.length === 0) return { ok: true, added: 0, skipped };

    const addIds = new Set(toAdd.map((c) => c.id));
    const catIngs = await db
      .select()
      .from(schema.catalogIngredients)
      .where(inArray(schema.catalogIngredients.catalogRecipeId, [...addIds]));

    // Insère chaque recette (id retourné), accumule tous les ingrédients pour une seule
    // insertion groupée à la fin (N+1 écritures au lieu de 2N).
    let added = 0;
    const ingRows: Array<typeof schema.recipeIngredients.$inferInsert> = [];
    for (const cat of cats) {
      if (!addIds.has(cat.id)) continue;
      const [row] = await db
        .insert(schema.recipes)
        .values({
          title: cat.title,
          sourceUrl: cat.sourceUrl,
          origine: "catalogue",
          imageUrl: cat.imageUrl,
          servings: cat.servings,
          instructions: cat.instructions,
        })
        .returning({ id: schema.recipes.id });
      if (!row) continue;
      added++;
      for (const i of catIngs.filter((x) => x.catalogRecipeId === cat.id)) {
        ingRows.push({
          recipeId: row.id,
          name: i.name,
          canonical: i.canonical,
          qty: i.qty,
          unit: i.unit,
          note: i.note,
        });
      }
    }
    if (ingRows.length > 0) await db.insert(schema.recipeIngredients).values(ingRows);

    revalidatePath("/recettes");
    return { ok: true, added, skipped };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Corrige une recette de la bibliothèque : nombre de portions de RÉFÉRENCE + ingrédients
 * (nom, quantité, unité, note), avec ajout/suppression. C'est le levier du « 100 % précis » :
 * toute erreur de détection est corrigeable à la main. Les ingrédients sont remplacés en bloc
 * (suppression + réinsertion) — les batchs référencent la recette, pas les lignes, donc rien ne casse.
 */
export async function updateRecipe(input: {
  recipeId: number;
  servings: number;
  ingredients: EditableIngredient[];
}): Promise<ActionResult> {
  try {
    await requireSession();
    const servings = clampServings(input.servings);
    const rows = prepareIngredientRows(input.ingredients);
    if (rows.length === 0) return { ok: false, error: "Garde au moins un ingrédient (avec un nom)." };

    await db.update(schema.recipes).set({ servings }).where(eq(schema.recipes.id, input.recipeId));
    await db.delete(schema.recipeIngredients).where(eq(schema.recipeIngredients.recipeId, input.recipeId));
    await db.insert(schema.recipeIngredients).values(
      rows.map((r) => ({
        recipeId: input.recipeId,
        name: r.name,
        canonical: r.canonical,
        qty: r.qty,
        unit: r.unit,
        note: r.note,
      })),
    );

    revalidatePath(`/recettes/${input.recipeId}`);
    revalidatePath("/recettes");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteRecipe(recipeId: number): Promise<ActionResult> {
  try {
    await requireSession();
    // Une recette utilisée par un batch est protégée (FK restrict) : erreur honnête.
    await db.delete(schema.recipes).where(eq(schema.recipes.id, recipeId));
    revalidatePath("/recettes");
    return { ok: true };
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      return {
        ok: false,
        error: "Suppression impossible : la recette est utilisée par un batch.",
      };
    }
    return fail(err);
  }
}

/**
 * Crée un batch depuis une sélection {recipeId, portions}, génère la liste d'épicerie
 * agrégée, puis tente l'estimation de budget LLM. L'estimation est BEST-EFFORT : si elle
 * échoue (clé absente, réseau), le batch existe quand même — items sans coût, marqués
 * inconnus, jamais un chiffre inventé.
 */
export async function createBatch(input: {
  name: string;
  selections: Array<{ recipeId: number; portions: number }>;
}): Promise<(ActionResult & { id?: number; estimationError?: string })> {
  try {
    await requireSession();
    const name = input.name.trim();
    const selections = input.selections.filter((s) => s.portions >= 1);
    if (!name) return { ok: false, error: "Donne un nom au batch." };
    if (selections.length === 0) return { ok: false, error: "Choisis au moins une recette." };

    const ids = selections.map((s) => s.recipeId);
    const recipeRows = await db
      .select()
      .from(schema.recipes)
      .where(inArray(schema.recipes.id, ids));
    if (recipeRows.length !== ids.length) {
      return { ok: false, error: "Recette introuvable dans la sélection." };
    }
    const ingredientRows = await db
      .select()
      .from(schema.recipeIngredients)
      .where(inArray(schema.recipeIngredients.recipeId, ids));

    const aggregated = aggregateShoppingList(
      selections.map((sel) => {
        const recipe = recipeRows.find((r) => r.id === sel.recipeId)!;
        return {
          servings: recipe.servings,
          portions: sel.portions,
          ingredients: ingredientRows
            .filter((i) => i.recipeId === sel.recipeId)
            .map((i) => ({ name: i.name, canonical: i.canonical, qty: i.qty, unit: i.unit })),
        };
      }),
    );

    const [batch] = await db
      .insert(schema.batches)
      .values({ name })
      .returning({ id: schema.batches.id });
    if (!batch) return { ok: false, error: "Création du batch échouée." };

    await db.insert(schema.batchRecipes).values(
      selections.map((s) => ({ batchId: batch.id, recipeId: s.recipeId, portions: s.portions })),
    );
    // Insertion AVEC returning : on récupère les id dans l'ordre d'`aggregated`, ce qui
    // permet de recoller les coûts par INDEX (pas par nom) — matching sûr à 100 %.
    const insertedItems = await db
      .insert(schema.shoppingItems)
      .values(
        aggregated.map((item) => ({
          batchId: batch.id,
          name: item.name,
          canonical: item.canonical,
          qty: item.qty,
          unit: item.unit,
        })),
      )
      .returning({ id: schema.shoppingItems.id });

    // Estimation : couverture 100 % garantie. Le LLM chiffre ce qu'il peut ; un filet
    // déterministe (fillMissingCosts) donne un prix à TOUT le reste — même si le LLM est
    // indisponible, aucun article ne part sans prix. Reste une estimation honnête.
    let estimationError: string | undefined;
    let llmCosts: Array<number | null> = new Array(aggregated.length).fill(null);
    try {
      llmCosts = await estimateShoppingCosts(aggregated); // aligné sur `aggregated`
    } catch (err) {
      estimationError = err instanceof Error ? err.message : String(err);
    }
    const costs = fillMissingCosts(aggregated, llmCosts);
    for (let idx = 0; idx < costs.length; idx++) {
      const item = insertedItems[idx];
      const cost = costs[idx];
      if (!item || cost === undefined) continue;
      await db
        .update(schema.shoppingItems)
        .set({ estCost: cost })
        .where(eq(schema.shoppingItems.id, item.id));
    }

    revalidatePath("/batchs");
    return { ok: true, id: batch.id, estimationError };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Exporte la liste d'épicerie d'un batch vers Google Tasks (cochable), une liste par
 * batch : le PREMIER export en crée une, chaque export SUIVANT met à jour la même liste
 * (id mémorisé sur `batches.googleTaskListId`) — ajouter un article puis réexporter ne
 * duplique jamais un groupe. N'exporte que le restant à acheter. Le jeton Google est lu
 * côté serveur (auth()).
 */
export async function exportBatchToTasks(
  batchId: number,
): Promise<ActionResult & { count?: number; updated?: boolean }> {
  try {
    await requireSession();
    const [batch] = await db.select().from(schema.batches).where(eq(schema.batches.id, batchId));
    if (!batch) return { ok: false, error: "Batch introuvable." };

    const items = await db
      .select({
        name: schema.shoppingItems.name,
        qty: schema.shoppingItems.qty,
        unit: schema.shoppingItems.unit,
        checked: schema.shoppingItems.checked,
      })
      .from(schema.shoppingItems)
      .where(eq(schema.shoppingItems.batchId, batchId));

    const titles = shoppingTitles(items);
    if (titles.length === 0) return { ok: false, error: "Liste vide — rien à exporter." };

    const res = await upsertTaskList(`Épicerie — ${batch.name}`, titles, batch.googleTaskListId);
    if (!res.ok) return { ok: false, error: res.error ?? "Export impossible." };
    if (res.listId && res.listId !== batch.googleTaskListId) {
      await db.update(schema.batches).set({ googleTaskListId: res.listId }).where(eq(schema.batches.id, batchId));
    }
    return { ok: true, count: res.created, updated: batch.googleTaskListId === res.listId };
  } catch (err) {
    return fail(err);
  }
}

export async function toggleShoppingItem(itemId: number, checked: boolean): Promise<ActionResult> {
  try {
    await requireSession();
    await db
      .update(schema.shoppingItems)
      .set({ checked, checkedAt: checked ? new Date() : null })
      .where(eq(schema.shoppingItems.id, itemId));
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

type ShoppingUnit = "g" | "ml" | "unite" | null;

interface ShoppingItemInput {
  name: string;
  qty: number | null;
  unit: ShoppingUnit;
  estCost: number | null;
}

/** Nettoie une saisie d'article : nom trimé, canonical dérivé, cohérence qty/unit, coût borné. */
function cleanShoppingInput(input: ShoppingItemInput): {
  name: string;
  canonical: string;
  qty: number | null;
  unit: ShoppingUnit;
  estCost: number | null;
} | null {
  const name = input.name.trim();
  if (!name) return null;
  const qty = input.qty !== null && Number.isFinite(input.qty) && input.qty > 0 ? input.qty : null;
  const estCost =
    input.estCost !== null && Number.isFinite(input.estCost) && input.estCost >= 0
      ? Math.round(input.estCost * 100) / 100
      : null;
  return { name, canonical: name.toLowerCase(), qty, unit: qty === null ? null : input.unit, estCost };
}

/** Ajoute un article MANUEL (hors recettes) à la liste d'un batch. */
export async function addShoppingItem(
  batchId: number,
  input: ShoppingItemInput,
): Promise<ActionResult> {
  try {
    await requireSession();
    const clean = cleanShoppingInput(input);
    if (!clean) return { ok: false, error: "Donne un nom à l'article." };
    await db.insert(schema.shoppingItems).values({
      batchId,
      name: clean.name,
      canonical: clean.canonical,
      qty: clean.qty,
      unit: clean.unit,
      estCost: clean.estCost,
    });
    revalidatePath(`/courses/${batchId}`);
    revalidatePath(`/batchs/${batchId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Modifie un article de la liste (nom, quantité, unité, coût). */
export async function updateShoppingItem(
  itemId: number,
  input: ShoppingItemInput,
): Promise<ActionResult> {
  try {
    await requireSession();
    const clean = cleanShoppingInput(input);
    if (!clean) return { ok: false, error: "Donne un nom à l'article." };
    await db
      .update(schema.shoppingItems)
      .set({
        name: clean.name,
        canonical: clean.canonical,
        qty: clean.qty,
        unit: clean.unit,
        estCost: clean.estCost,
      })
      .where(eq(schema.shoppingItems.id, itemId));
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Retire un article de la liste. */
export async function deleteShoppingItem(itemId: number): Promise<ActionResult> {
  try {
    await requireSession();
    await db.delete(schema.shoppingItems).where(eq(schema.shoppingItems.id, itemId));
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function setBatchStatus(
  batchId: number,
  status: "planifie" | "courses" | "cuisine" | "termine",
): Promise<ActionResult> {
  try {
    await requireSession();
    // « Terminé » n'est pas un statut comme les autres : c'est lui qui fabrique le stock,
    // et ça exige de savoir OÙ va chaque recette. Il passe donc par `terminerBatch`.
    if (status === "termine") {
      return { ok: false, error: "Passe par le rangement pour terminer un batch." };
    }
    await db.update(schema.batches).set({ status }).where(eq(schema.batches.id, batchId));
    revalidatePath("/batchs");
    revalidatePath(`/batchs/${batchId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Termine un batch ET range ce qu'il a produit.
 *
 * C'est ici que la boucle se referme : jusqu'au 17/08/2026 le statut passait à « terminé »
 * et l'app oubliait tout, alors que le batch cooking est précisément ce qui vient après.
 *
 * ⚠️ IDEMPOTENCE — le garde n'est pas le statut, ce sont les PORTIONS DÉJÀ RANGÉES.
 * Un double envoi, un retour arrière puis un nouveau clic, ou un aller-retour
 * « terminé → cuisine → terminé » créeraient sinon un deuxième jeu de portions : on
 * annoncerait à Marc deux fois plus de repas qu'il n'en a. Refuser sur le statut seul ne
 * couvre pas le troisième cas, puisque repasser par « cuisine » le remet à zéro.
 */
export async function terminerBatch(
  batchId: number,
  lignes: RangementBrut[],
): Promise<ActionResult> {
  try {
    await requireSession();

    const valide = validerRangements(lignes);
    if (!valide.ok) return { ok: false, error: valide.erreur };

    const [batch] = await db.select().from(schema.batches).where(eq(schema.batches.id, batchId));
    if (!batch) return { ok: false, error: "Ce batch n'existe plus." };

    const dejaRangees = await db
      .select({ id: schema.portions.id })
      .from(schema.portions)
      .where(eq(schema.portions.batchId, batchId));
    if (dejaRangees.length > 0) {
      return {
        ok: false,
        error: "Ce batch a déjà été rangé — ses portions sont dans « Portions ».",
      };
    }

    await db.insert(schema.portions).values(
      valide.rangements.map((r) => ({
        batchId,
        recipeId: r.recipeId,
        titre: r.titre,
        zone: r.zone,
        restantes: r.portions,
      })),
    );
    await db
      .update(schema.batches)
      .set({ status: "termine" })
      .where(eq(schema.batches.id, batchId));

    revalidatePath("/batchs");
    revalidatePath(`/batchs/${batchId}`);
    revalidatePath("/portions");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Déclare un article comme « j'ai toujours ça » (garde-manger).
 *
 * L'article n'est PAS retiré de la liste courante : il passe dans « à vérifier au placard »,
 * toujours visible et toujours cochable. Le supprimer ferait rentrer Marc sans son huile le
 * jour où le pot est vide, et l'app ne le saurait jamais.
 */
export async function ajouterAuGardeManger(nom: string, canonical: string): Promise<ActionResult> {
  try {
    await requireSession();
    const valide = validerAjoutGardeManger(nom, canonical);
    if (!valide.ok) return { ok: false, error: valide.erreur };

    // Déclarer deux fois le même article n'est pas une erreur — c'est un geste répété en
    // magasin. `onConflictDoNothing` le rend inoffensif plutôt que de le faire échouer.
    await db
      .insert(schema.pantry)
      .values({ canonical: valide.cle, nom: valide.nom })
      .onConflictDoNothing({ target: schema.pantry.canonical });

    revalidatePath("/courses", "layout");
    revalidatePath("/garde-manger");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Retire un article du garde-manger : il redevient un achat normal. */
export async function retirerDuGardeManger(id: number): Promise<ActionResult> {
  try {
    await requireSession();
    await db.delete(schema.pantry).where(eq(schema.pantry.id, id));
    revalidatePath("/courses", "layout");
    revalidatePath("/garde-manger");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Consomme une portion (le geste « j'en mange une »).
 *
 * Le décrément se fait EN BASE (`restantes - 1`) et non en relisant puis réécrivant : deux
 * onglets ouverts sur le même stock retireraient sinon la même portion deux fois en n'en
 * décomptant qu'une. Le `restantes > 0` de la clause protège du passage en négatif.
 */
export async function consommerPortion(portionId: number): Promise<ActionResult> {
  try {
    await requireSession();
    const [restant] = await db
      .update(schema.portions)
      .set({ restantes: sql`${schema.portions.restantes} - 1` })
      .where(and(eq(schema.portions.id, portionId), gt(schema.portions.restantes, 0)))
      .returning({ restantes: schema.portions.restantes });

    if (!restant) {
      return { ok: false, error: "Cette portion n'est plus en stock." };
    }
    // Une ligne à zéro n'est pas « zéro portion de chili » : c'est l'absence de chili.
    if (restant.restantes <= 0) {
      await db.delete(schema.portions).where(eq(schema.portions.id, portionId));
    }

    revalidatePath("/portions");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteBatch(batchId: number): Promise<ActionResult> {
  try {
    await requireSession();
    await db.delete(schema.batches).where(eq(schema.batches.id, batchId));
    revalidatePath("/batchs");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Copie une recette du CATALOGUE de découverte vers la bibliothèque perso. Duplication
 * pure (le catalogue reste intact) ; les ingrédients sont déjà normalisés à l'import.
 */
export async function addCatalogRecipeToLibrary(
  catalogRecipeId: number,
): Promise<ActionResult & { id?: number }> {
  try {
    await requireSession();
    const [cat] = await db
      .select()
      .from(schema.catalogRecipes)
      .where(eq(schema.catalogRecipes.id, catalogRecipeId));
    if (!cat) return { ok: false, error: "Recette du catalogue introuvable." };

    const catIngs = await db
      .select()
      .from(schema.catalogIngredients)
      .where(eq(schema.catalogIngredients.catalogRecipeId, catalogRecipeId));

    const [row] = await db
      .insert(schema.recipes)
      .values({
        title: cat.title,
        sourceUrl: cat.sourceUrl,
        origine: "catalogue",
        imageUrl: cat.imageUrl,
        servings: cat.servings,
        instructions: cat.instructions,
      })
      .returning({ id: schema.recipes.id });
    if (!row) return { ok: false, error: "Copie de la recette échouée." };

    if (catIngs.length > 0) {
      await db.insert(schema.recipeIngredients).values(
        catIngs.map((i) => ({
          recipeId: row.id,
          name: i.name,
          canonical: i.canonical,
          qty: i.qty,
          unit: i.unit,
          note: i.note,
        })),
      );
    }

    revalidatePath("/recettes");
    return { ok: true, id: row.id };
  } catch (err) {
    return fail(err);
  }
}
