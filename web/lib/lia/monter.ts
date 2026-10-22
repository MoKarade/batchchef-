// lib/lia/monter.ts — LIA n'apparaît que pour une session admise (pas sur /login).

import { NonAutorise, requireSession } from "@/lib/lia/session";

export async function liaAutorisee(): Promise<boolean> {
  try {
    await requireSession();
    return true;
  } catch (erreur) {
    if (erreur instanceof NonAutorise) return false;
    throw erreur;
  }
}
