// app/api/lia/ask/route.ts — la question de Marc à LIA, relayée au hub (qui la passe à MemoryAI).
//
// DERRIÈRE le middleware d'authentification (jamais dans ses exclusions) ET revérifiée ici par
// `requireSession()` : deux gardes indépendantes. Le jeton de l'app (`HUB_TOKEN`) ne sort
// jamais du serveur ; le navigateur ne parle qu'à cette route, sur la même origine.
// Seul POST est exporté : Next répond 405 aux autres méthodes.

import { LiaIndisponible, demanderAuHub } from "@/lib/lia/demander";
import { DemandeLia, estProprietaire } from "@/lib/lia/contrat";
import { NonAutorise, requireSession } from "@/lib/lia/session";

export const dynamic = "force-dynamic";
/** Le hub a 35 s (MemoryAI 30 s) pour répondre : la fonction doit survivre à ce délai. */
export const maxDuration = 40;

/** Une question de 2 000 caractères tient très en dessous. Plus gros = pas une question. */
const CORPS_MAX_OCTETS = 8 * 1024;

const reponse = (corps: unknown, status: number) =>
  Response.json(corps, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request): Promise<Response> {
  let email: string;
  try {
    ({ email } = await requireSession());
  } catch (erreur) {
    if (erreur instanceof NonAutorise) return reponse({ error: "unauthenticated" }, 401);
    throw erreur;
  }

  const brut = await req.text();
  if (new TextEncoder().encode(brut).length > CORPS_MAX_OCTETS) {
    return reponse({ error: "corps_trop_grand" }, 413);
  }
  let json: unknown;
  try {
    json = JSON.parse(brut);
  } catch {
    return reponse({ error: "corps_invalide" }, 400);
  }
  const demande = DemandeLia.safeParse(json);
  if (!demande.success) return reponse({ error: "corps_invalide" }, 400);

  try {
    return reponse(await demanderAuHub(demande.data, {
        proprietaire: estProprietaire(email, process.env.AUTHORIZED_EMAIL),
        signal: req.signal,
      }), 200);
  } catch (erreur) {
    if (erreur instanceof LiaIndisponible) return reponse({ error: "lia_indisponible" }, 503);
    throw erreur;
  }
}
