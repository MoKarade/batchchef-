// app/api/lia/pause/route.ts — la pause générale de LIA, telle que le hub la tient, relayée à la page de l'app.
//
//   GET /api/lia/pause → 200 { pause: boolean } · 401 pas de session · 503 pause illisible (la page la tient pour posée)
//
// DERRIÈRE le middleware d'authentification (jamais dans ses exclusions) ET revérifiée ici par `requireSession()`.
// Lecture seule : l'écriture de la pause reste au hub. Seul GET est exporté : Next répond 405 aux autres méthodes.

import { lirePauseHub } from "@/lib/lia/pauseHub";
import { NonAutorise, requireSession } from "@/lib/lia/session";

export const dynamic = "force-dynamic";

const reponse = (corps: unknown, status: number) =>
  Response.json(corps, { status, headers: { "cache-control": "no-store" } });

export async function GET(req: Request): Promise<Response> {
  try {
    await requireSession();
  } catch (erreur) {
    if (erreur instanceof NonAutorise) return reponse({ error: "unauthenticated" }, 401);
    throw erreur;
  }
  const pause = await lirePauseHub(req.headers.get("cookie"), { signal: req.signal });
  if (pause === null) return reponse({ error: "pause_illisible" }, 503);
  return reponse({ pause }, 200);
}
