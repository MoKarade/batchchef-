// app/api/lia/ask/route.ts — la question de Marc à LIA, relayée au hub (qui la passe à MemoryAI).
//
// DERRIÈRE le middleware d'authentification (jamais dans ses exclusions) ET revérifiée ici par
// `requireSession()` : deux gardes indépendantes. Le jeton de l'app (`HUB_TOKEN`) ne sort
// jamais du serveur ; le navigateur ne parle qu'à cette route, sur la même origine.
// Seul POST est exporté : Next répond 405 aux autres méthodes.

import { repondreAtelier } from "@/lib/assistant/atelierServeur";
import { LiaEnPause, LiaIndisponible, demanderAuHub } from "@/lib/lia/demander";
import { CORPS_ATELIER_MAX_OCTETS, DemandeAtelier, DemandeLia, estProprietaire } from "@/lib/lia/contrat";
import { NonAutorise, requireSession } from "@/lib/lia/session";

export const dynamic = "force-dynamic";
/**
 * Le hub a 35 s (MemoryAI 30 s) pour répondre ; la boucle de l'atelier (/assistant) a un budget de 45 s (`BUDGET_MS`) et la
 * plateforme coupe au-delà de ce que la fonction déclare : 60 s, comme l'ancienne page.
 */
export const maxDuration = 60;

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
  const octets = new TextEncoder().encode(brut).length;
  // Une borne large pour l'atelier (il porte l'historique), sans toucher à celle de la bulle : `atelier` est relu plus bas.
  if (octets > CORPS_ATELIER_MAX_OCTETS) return reponse({ error: "corps_trop_grand" }, 413);
  let json: unknown;
  try {
    json = JSON.parse(brut);
  } catch {
    return reponse({ error: "corps_invalide" }, 400);
  }

  const veutAtelier = typeof json === "object" && json !== null && (json as { atelier?: unknown }).atelier === true;
  if (veutAtelier) {
    // La page /assistant : le moteur de recettes de l'app, pas le hub. La bulle des autres pages n'arrive jamais ici, et une
    // demande d'atelier mal formée est refusée au lieu de glisser vers le hub.
    const atelier = DemandeAtelier.safeParse(json);
    if (!atelier.success) return reponse({ error: "corps_invalide" }, 400);
    try {
      const resultat = await repondreAtelier(atelier.data);
      if (!resultat.ok) {
        console.error(`[lia/ask] atelier : ${resultat.erreur}`);
        return reponse({ error: "lia_indisponible" }, 503);
      }
      return reponse(resultat.reponse, 200);
    } catch (erreur) {
      // Le modèle ou la base en panne : la RAISON au journal (jamais la question), 503 au navigateur.
      console.error(`[lia/ask] atelier : ${erreur instanceof Error ? erreur.message : "erreur inconnue"}`);
      return reponse({ error: "lia_indisponible" }, 503);
    }
  }

  if (octets > CORPS_MAX_OCTETS) return reponse({ error: "corps_trop_grand" }, 413);
  const demande = DemandeLia.safeParse(json);
  if (!demande.success) return reponse({ error: "corps_invalide" }, 400);

  try {
    return reponse(await demanderAuHub(demande.data, {
        proprietaire: estProprietaire(email, process.env.AUTHORIZED_EMAIL),
        signal: req.signal,
      }), 200);
  } catch (erreur) {
    // Pause générale du hub : le modèle n'a pas été appelé. 423, distinct de la panne (503).
    if (erreur instanceof LiaEnPause) return reponse({ error: "paused" }, 423);
    if (erreur instanceof LiaIndisponible) {
      // La RAISON (« le hub a répondu 401 »…), jamais la question ni un jeton : un refus du hub ne doit pas rester muet.
      console.error(`[lia/ask] ${erreur.message}`);
      return reponse({ error: "lia_indisponible" }, 503);
    }
    throw erreur;
  }
}
