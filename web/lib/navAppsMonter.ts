// lib/navAppsMonter.ts — dit si l'onglet « Apps » se monte, et quelle app il habille.
// Propriétaire seulement (AUTHORIZED_EMAIL, comparaison sans réseau) : un invité admis par le hub ne le voit pas,
// et la page de connexion (sans session) non plus. Échec fermé : toute autre erreur remonte.

import type { AppId } from "@/lib/appsDuParc";
import { isAuthorizedEmail } from "@/lib/authorized";
import { NonAutorise, requireSession } from "@/lib/lia/session";

/** Id de CETTE app dans `lib/appsDuParc.ts` : l'onglet ne la propose pas. */
export const APP_COURANTE: AppId = "batchchef";

export async function navAppsAutorisee(): Promise<boolean> {
  try {
    const { email } = await requireSession();
    return isAuthorizedEmail(email, process.env.AUTHORIZED_EMAIL);
  } catch (erreur) {
    if (erreur instanceof NonAutorise) return false;
    throw erreur;
  }
}
