"use server";

// lib/actions/courses.ts — liste d'épicerie d'un batch : cocher, ajouter, modifier, retirer, exporter.
//
// Server Actions : chaque export est un point d'entrée appelable depuis le navigateur, et
// revérifie donc la session EN TÊTE (défense en profondeur : le middleware garde déjà).
// Jamais de fonction `*Interne` ici (faille M2) : elles vivent dans lib/actionsInternes/.
// Chaque échec est retourné comme message honnête, jamais avalé.

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { shoppingTitles } from "@/lib/aggregate";
import { upsertTaskList } from "@/lib/googleTasks";
import { cocherArticleInterne } from "@/lib/actionsInternes/courses";
import { fail, type ActionResult } from "@/lib/actionsInternes/commun";
import { requireSession } from "@/lib/actionsInternes/session";

/** Point d'entrée UTILISATEUR : session d'abord, puis le travail. */
export async function toggleShoppingItem(itemId: number, checked: boolean): Promise<ActionResult> {
  try {
    await requireSession();
    return await cocherArticleInterne(itemId, checked);
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
