// lib/lia/demander.ts — l'appel serveur vers le hub, qui relaie à MemoryAI (I/O ; la logique est
// dans contrat.ts).
//
// Échec FERMÉ : pas de jeton, URL douteuse, réponse non conforme, délai dépassé, hub ou MemoryAI
// en panne → `LiaIndisponible`, jamais une réponse inventée (« no fake data »). La question de
// Marc n'est ni journalisée ni mise en cache.

import {
  CHEMIN_ASK_HUB,
  DELAI_HUB_MS,
  ReponseLiaApp,
  URL_HUB_DEFAUT,
  type DemandeLia,
} from "@/lib/lia/contrat";

export class LiaIndisponible extends Error {
  constructor(raison: string) {
    super(`LIA indisponible : ${raison}`);
    this.name = "LiaIndisponible";
  }
}

export interface OptionsDemande {
  /** La session est celle du propriétaire (`estProprietaire`) : sinon MemoryAI refuse (403). */
  proprietaire?: boolean;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  env?: Readonly<Record<string, string | undefined>>;
}

/** URL de l'API ask du hub ; https obligatoire (le jeton voyage dans l'en-tête). */
function urlAsk(base: string): string {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new LiaIndisponible("NEXT_PUBLIC_HUB_URL invalide");
  }
  if (url.protocol !== "https:") throw new LiaIndisponible("NEXT_PUBLIC_HUB_URL doit être en https");
  return new URL(CHEMIN_ASK_HUB, url).toString();
}

export async function demanderAuHub(
  demande: DemandeLia,
  { proprietaire = false, signal, fetchImpl = fetch, env = process.env }: OptionsDemande = {},
): Promise<ReponseLiaApp> {
  const jeton = env.HUB_TOKEN;
  if (!jeton) throw new LiaIndisponible("HUB_TOKEN absent");
  const url = urlAsk(env.NEXT_PUBLIC_HUB_URL?.trim() || URL_HUB_DEFAUT);

  const delai = AbortSignal.timeout(DELAI_HUB_MS);
  let reponse: Response;
  try {
    reponse = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-token": jeton },
      body: JSON.stringify({ ...demande, proprietaire }),
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, delai]) : delai,
    });
  } catch (erreur) {
    // L'annulation par le navigateur (onglet fermé) n'est pas une panne : on la relaie telle quelle.
    if (signal?.aborted) throw erreur;
    throw new LiaIndisponible("hub injoignable ou trop lent");
  }
  if (!reponse.ok) throw new LiaIndisponible(`le hub a répondu ${reponse.status}`);

  let corps: unknown;
  try {
    corps = await reponse.json();
  } catch {
    throw new LiaIndisponible("réponse du hub illisible");
  }
  const lue = ReponseLiaApp.safeParse(corps);
  if (!lue.success) throw new LiaIndisponible("réponse du hub non conforme");
  return lue.data;
}
