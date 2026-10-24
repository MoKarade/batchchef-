// lib/lia/client.ts — le `ask` que `@mokarade/lia-ui` appelle, côté navigateur.
//
// Parle à la route de CETTE app (même origine, cookie de session), jamais au hub ni à MemoryAI : aucun
// jeton dans le navigateur. Toute erreur devient un rejet : le paquet affiche alors
// « indisponible » (échec fermé), jamais une réponse inventée.

import { ReponseLiaApp } from "@/lib/lia/contrat";
import { lireReponsePause } from "@/lib/lia/pause";

export async function demanderLia(
  question: string,
  signal: AbortSignal,
  { fetchImpl = fetch, page = "/" }: { fetchImpl?: typeof fetch; page?: string } = {},
): Promise<ReponseLiaApp> {
  const reponse = await fetchImpl("/api/lia/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, page }),
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (reponse.status === 423) throw new Error("LIA en pause (423)");
  if (!reponse.ok) throw new Error(`LIA indisponible (${reponse.status})`);
  const lue = ReponseLiaApp.safeParse(await reponse.json());
  if (!lue.success) throw new Error("LIA indisponible (réponse non conforme)");
  return lue.data;
}

/** La pause générale lue par la page (route de l'app, même origine, cookie de session). `null` : illisible, donc en pause. */
export async function lirePauseServeur(fetchImpl: typeof fetch = fetch): Promise<boolean | null> {
  const reponse = await fetchImpl("/api/lia/pause", { cache: "no-store", credentials: "same-origin" });
  let json: unknown = null;
  try {
    json = await reponse.json();
  } catch {
    json = null;
  }
  return lireReponsePause(reponse.status, json);
}
