"use server";

// lib/actions/batch.ts — création, statut et suppression d'un batch.
//
// Server Actions : chaque export est un point d'entrée appelable depuis le navigateur, et
// revérifie donc la session EN TÊTE (défense en profondeur : le middleware garde déjà).
// Jamais de fonction `*Interne` ici (faille M2) : elles vivent dans lib/actionsInternes/.
// Chaque échec est retourné comme message honnête, jamais avalé.

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { creerBatchInterne } from "@/lib/actionsInternes/batch";
import { requetesDeterminer, requetesTerminer } from "@/lib/historiqueDb";
import { fail, type ActionResult } from "@/lib/actionsInternes/commun";
import { requireSession } from "@/lib/actionsInternes/session";

/**
 * Crée un batch depuis une sélection {recipeId, portions}, génère la liste d'épicerie
 * agrégée, puis tente l'estimation de budget LLM. L'estimation est BEST-EFFORT : si elle
 * échoue (clé absente, réseau), le batch existe quand même — items sans coût, marqués
 * inconnus, jamais un chiffre inventé.
 *
 * Point d'entrée UTILISATEUR : session d'abord, puis le travail (`creerBatchInterne`).
 */
export async function createBatch(input: {
  name: string;
  selections: Array<{ recipeId: number; portions: number }>;
}): Promise<(ActionResult & { id?: number; estimationError?: string })> {
  try {
    await requireSession();
    return await creerBatchInterne(input);
  } catch (err) {
    return fail(err);
  }
}

/**
 * Change l'étape d'un batch, et tient l'historique de ce qui a été cuisiné (HIST-01).
 *
 * « Terminé » crée la trace (une ligne par recette) ; toute autre étape efface celle de CE
 * batch — un recul corrige une fausse manœuvre. Les deux passent dans le MÊME `db.batch`
 * que le statut : si l'historique échoue, le statut ne change pas, et l'erreur est dite.
 * Pas de lecture préalable du statut : l'insertion ignore les doublons et la suppression
 * est sans effet quand il n'y a rien, donc deux onglets ne peuvent pas se contredire.
 */
export async function setBatchStatus(
  batchId: number,
  status: "planifie" | "courses" | "cuisine" | "termine",
): Promise<ActionResult> {
  try {
    await requireSession();
    const miseAJour = db.update(schema.batches).set({ status }).where(eq(schema.batches.id, batchId));
    await db.batch([
      miseAJour,
      status === "termine" ? requetesTerminer(batchId) : requetesDeterminer(batchId),
    ]);
    revalidatePath("/historique");
    revalidatePath("/batchs");
    revalidatePath(`/batchs/${batchId}`);
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
    // La trace survit (clés `set null`) mais perd son lien vers le batch.
    revalidatePath("/historique");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
