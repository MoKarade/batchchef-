// lib/actionsInternes/courses.ts — cochage d'un article (travail, sans contrôle d'accès).
//
// Module ORDINAIRE (pas de "use server") : une fonction de travail exportée d'un fichier
// "use server" deviendrait une Server Action appelable depuis le navigateur SANS session
// (faille M2). Deux appelants autorisés, chacun avec SA preuve : la Server Action (session)
// et la route MCP (jeton `MCP_TOKEN`).

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { evenementListeTerminee, planifierSorties } from "@/lib/sortiesMemoryAI";
import { fail, type ActionResult } from "./commun";

/**
 * Cocher le DERNIER article d'une liste la termine : un événement part vers MemoryAI. Lecture après
 * l'écriture, dans son propre `try` : une défaillance ici ne fait JAMAIS échouer le cochage. Une
 * liste décochée puis recochée renvoie la même `ref` (déduplication côté MemoryAI).
 */
async function signalerListeTerminee(itemId: number): Promise<void> {
  try {
    const [article] = await db
      .select({ batchId: schema.shoppingItems.batchId })
      .from(schema.shoppingItems)
      .where(eq(schema.shoppingItems.id, itemId))
      .limit(1);
    if (!article) return;
    const articles = await db
      .select({ checked: schema.shoppingItems.checked })
      .from(schema.shoppingItems)
      .where(eq(schema.shoppingItems.batchId, article.batchId));
    if (articles.length === 0 || articles.some((a) => !a.checked)) return;
    const [batch] = await db
      .select({ name: schema.batches.name })
      .from(schema.batches)
      .where(eq(schema.batches.id, article.batchId))
      .limit(1);
    if (!batch) return;
    planifierSorties([
      evenementListeTerminee({
        batchId: article.batchId,
        nom: batch.name,
        articles: articles.length,
      }),
    ]);
  } catch {
    console.warn("[memoryai-sorties]", { raison: "liste_terminee_illisible" });
  }
}

/** Le TRAVAIL de cochage, sans contrôle d'accès (cf. `creerBatchInterne`). */
export async function cocherArticleInterne(
  itemId: number,
  checked: boolean,
): Promise<ActionResult> {
  try {
    await db
      .update(schema.shoppingItems)
      .set({ checked, checkedAt: checked ? new Date() : null })
      .where(eq(schema.shoppingItems.id, itemId));
    if (checked) await signalerListeTerminee(itemId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
