// lib/lia/pauseHub.ts — lire la pause générale de LIA chez le hub, pour le compte de l'utilisateur (I/O ; le jugement de la
// réponse est dans pause.ts, pur).
//
// Le hub garde la pause en base et ne la rend qu'à une SESSION de propriétaire (`GET /api/lia/pause` : 401 sans session, 403
// pour un invité). Le cookie de session est partagé entre les sous-domaines de l'écosystème : l'app le transmet tel quel, côté
// serveur, vers le hub (https obligatoire, comme pour `ask`). Rien n'en est gardé ni journalisé.
//
// Échec FERMÉ : toute lecture qui n'est pas un 200 conforme rend `null` (illisible = en pause pour l'appelant).

import { urlHub } from "@/lib/lia/demander";
import { fetchHubAvecCookie } from "@/lib/lia/hubCookie";
import { URL_HUB_DEFAUT } from "@/lib/lia/contrat";
import { lireReponsePause } from "@/lib/lia/pause";

const CHEMIN_PAUSE_HUB = "/api/lia/pause";
/** La pause est une petite lecture : au-delà, on la déclare illisible plutôt que d'attendre. */
const DELAI_PAUSE_MS = 5_000;

export interface OptionsLecturePause {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  env?: Readonly<Record<string, string | undefined>>;
}

export async function lirePauseHub(
  cookie: string | null,
  { signal, fetchImpl = fetch, env = process.env }: OptionsLecturePause = {},
): Promise<boolean | null> {
  if (!cookie) return null;
  try {
    const url = urlHub(env.NEXT_PUBLIC_HUB_URL?.trim() || URL_HUB_DEFAUT, CHEMIN_PAUSE_HUB);
    const delai = AbortSignal.timeout(DELAI_PAUSE_MS);
    const reponse = await fetchHubAvecCookie(url, {
      method: "GET",
      headers: { cookie },
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, delai]) : delai,
    }, fetchImpl);
    if (reponse.status !== 200) console.error(`[lia/pause] le hub a répondu ${reponse.status}`);
    let json: unknown = null;
    try {
      json = await reponse.json();
    } catch {
      json = null;
    }
    return lireReponsePause(reponse.status, json);
  } catch {
    return null;
  }
}
