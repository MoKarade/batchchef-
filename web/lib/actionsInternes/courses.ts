// lib/actionsInternes/courses.ts — cochage d'un article (travail, sans contrôle d'accès).
//
// Module ORDINAIRE (pas de "use server") : une fonction de travail exportée d'un fichier
// "use server" deviendrait une Server Action appelable depuis le navigateur SANS session
// (faille M2). Deux appelants autorisés, chacun avec SA preuve : la Server Action (session)
// et la route MCP (jeton `MCP_TOKEN`).

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { fail, type ActionResult } from "./commun";

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
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
