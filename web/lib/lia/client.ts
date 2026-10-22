// lib/lia/client.ts — le `ask` que `@mokarade/lia-ui` appelle, côté navigateur.
//
// Parle à la route de CETTE app (même origine, cookie de session), jamais au hub ni à MemoryAI : aucun
// jeton dans le navigateur. Toute erreur devient un rejet : le paquet affiche alors
// « indisponible » (échec fermé), jamais une réponse inventée.

import { ReponseLiaApp } from "@/lib/lia/contrat";

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
  if (!reponse.ok) throw new Error(`LIA indisponible (${reponse.status})`);
  const lue = ReponseLiaApp.safeParse(await reponse.json());
  if (!lue.success) throw new Error("LIA indisponible (réponse non conforme)");
  return lue.data;
}
