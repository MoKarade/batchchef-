// app/api/lia/etat/route.ts — l'état partagé de LIA, tel que le hub le tient (MemoryAI), relayé à la page de l'app.
//
//   GET /api/lia/etat → 200 + l'état · 204 s'il n'y en a aucun
//   PUT /api/lia/etat   corps : l'état de LIA (contrat `commun/assistant/CONTRAT-etat-lia.md`)
//                       → 200 + l'état gardé · 409 + l'état plus récent · 400 / 413 corps refusé
//   401 : pas de session · 403 : invité du hub · 429 : trop vite · 503 : hub ou mémoire injoignable (LIA garde son état local)
//
// UNE seule LIA, un seul état (Marc, 23/10/2026). DERRIÈRE le middleware d'authentification (jamais dans ses exclusions) ET
// revérifiée ici par `requireSession()` : deux gardes indépendantes. Le navigateur ne parle qu'à cette route, sur la même
// origine (`etatHttp("/api/lia/etat")`) ; le hub juge la session du propriétaire. Seuls GET et PUT sont exportés : Next
// répond 405 aux autres méthodes.

import { TAILLE_MAX_ETAT, lireCorpsEtat, type Relais } from "@/lib/lia/etat";
import { relayerEtatHub } from "@/lib/lia/etatHub";
import { NonAutorise, requireSession } from "@/lib/lia/session";

export const dynamic = "force-dynamic";

const ENTETES = { "cache-control": "no-store" } as const;

const reponse = (corps: unknown, status: number) => Response.json(corps, { status, headers: ENTETES });

function repondre({ status, corps }: Relais): Response {
  return corps === null ? new Response(null, { status, headers: ENTETES }) : reponse(corps, status);
}

async function exigerSession(): Promise<Response | null> {
  try {
    await requireSession();
    return null;
  } catch (erreur) {
    if (erreur instanceof NonAutorise) return reponse({ error: "unauthenticated" }, 401);
    throw erreur;
  }
}

export async function GET(req: Request): Promise<Response> {
  const refus = await exigerSession();
  if (refus) return refus;
  return repondre(await relayerEtatHub("GET", req.headers.get("cookie"), { signal: req.signal }));
}

export async function PUT(req: Request): Promise<Response> {
  const refus = await exigerSession();
  if (refus) return refus;

  // Le corps est jugé AVANT tout saut réseau : un état hors contrat n'atteint pas le hub.
  const annonce = Number(req.headers.get("content-length"));
  if (Number.isFinite(annonce) && annonce > TAILLE_MAX_ETAT) return reponse({ error: "payload_too_large" }, 413);
  const lu = lireCorpsEtat(await req.text());
  if (!lu.ok) return reponse({ error: lu.error }, lu.status);

  return repondre(
    await relayerEtatHub("PUT", req.headers.get("cookie"), { corps: JSON.stringify(lu.etat), signal: req.signal }),
  );
}
