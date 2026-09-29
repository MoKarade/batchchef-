// lib/actionsInternes/session.ts — contrôle de session des Server Actions.
//
// Module ORDINAIRE (pas de "use server"), séparé de `commun.ts` : les fonctions de travail
// n'en dépendent pas (elles ne contrôlent pas l'accès, leurs appelants le font).

import { auth } from "@/auth";

/** Refuse (exception) si aucune session : à appeler en TÊTE de chaque Server Action. */
export async function requireSession(): Promise<void> {
  const session = await auth();
  if (!session) throw new Error("Session requise.");
}
