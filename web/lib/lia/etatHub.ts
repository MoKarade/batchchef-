// lib/lia/etatHub.ts — lire et écrire l'état partagé de LIA chez le hub, pour le compte de l'utilisateur (I/O ; le jugement
// est dans etat.ts, pur).
//
// Le hub ne rend l'état qu'à une SESSION de propriétaire (`/api/lia/etat` : 401 sans session, 403 pour un invité) et le relaie
// à MemoryAI avec ses propres jetons. Le cookie de session est partagé entre les sous-domaines de l'écosystème : l'app le
// transmet tel quel, côté serveur, vers le hub (https obligatoire, comme pour `ask` et la pause). Aucun jeton d'app ne part ici.
// Rien n'est gardé ni journalisé : ni l'état, ni le cookie.
//
// Échec FERMÉ : toute erreur réseau ou délai devient 503 ; LIA garde son état local et vit quand même.

import { URL_HUB_DEFAUT } from "@/lib/lia/contrat";
import { urlHub } from "@/lib/lia/demander";
import { fetchHubAvecCookie } from "@/lib/lia/hubCookie";
import { relayerReponseEtat, type MethodeEtat, type Relais } from "@/lib/lia/etat";

const CHEMIN_ETAT_HUB = "/api/lia/etat";
/** Le hub a 8 s pour MemoryAI ; l'état est une petite ligne, on n'attend pas plus longtemps que lui. */
const DELAI_ETAT_MS = 10_000;

export interface OptionsEtatHub {
  /** Corps JSON déjà jugé (PUT seulement). */
  corps?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  env?: Readonly<Record<string, string | undefined>>;
}

const indisponible: Relais = { status: 503, corps: { error: "unavailable" } };

export async function relayerEtatHub(
  methode: MethodeEtat,
  cookie: string | null,
  { corps, signal, fetchImpl = fetch, env = process.env }: OptionsEtatHub = {},
): Promise<Relais> {
  if (!cookie) return indisponible;
  try {
    const url = urlHub(env.NEXT_PUBLIC_HUB_URL?.trim() || URL_HUB_DEFAUT, CHEMIN_ETAT_HUB);
    const delai = AbortSignal.timeout(DELAI_ETAT_MS);
    const reponse = await fetchHubAvecCookie(url, {
      method: methode,
      headers: { cookie, ...(corps !== undefined && { "content-type": "application/json" }) },
      ...(corps !== undefined && { body: corps }),
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, delai]) : delai,
    }, fetchImpl);
    // Le STATUT d'un refus du hub va au journal serveur (jamais le cookie ni l'état) : un 401 ne doit pas rester muet.
    if (![200, 204, 409].includes(reponse.status)) console.error(`[lia/etat] le hub a répondu ${reponse.status}`);
    return relayerReponseEtat(methode, reponse.status, await reponse.text());
  } catch {
    return indisponible;
  }
}
