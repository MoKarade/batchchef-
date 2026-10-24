// lib/lia/hubCookie.ts — appeler le hub AVEC le cookie de session de l'utilisateur, sans le perdre en route (I/O).
//
// ⚠️ Le hub sert `www.hubperso.com` et `hubperso.com` répond 308 vers lui. `fetch` (undici, Node) RETIRE l'en-tête `cookie` quand
// une redirection change d'origine — comme `authorization`, pas les en-têtes personnalisés (`x-hub-token` de `ask` survit). Le hub
// recevait donc la requête sans session : 401 sur `/api/lia/etat` et `/api/lia/pause`, constaté en production le 24/10/2026.
// On suit donc la redirection NOUS-MÊMES, une seule fois, et seulement vers le même hôte à `www.` près, en https, en 307/308
// (méthode et corps conservés) : le cookie ne part jamais vers un autre site. Tout autre cas = redirection non suivie, 3xx rendu tel quel
// (les appelants le jugent comme n'importe quelle réponse hors contrat : échec fermé).

const REDIRECTIONS_SUIVIES = new Set([307, 308]);

/** Même site, à `www.` près : `hubperso.com` ↔ `www.hubperso.com`, rien d'autre. */
export function memeSiteAuWwwPres(a: URL, b: URL): boolean {
  const nu = (h: string) => h.replace(/^www\./, "");
  return a.protocol === "https:" && b.protocol === "https:" && a.port === b.port && nu(a.hostname) === nu(b.hostname);
}

export async function fetchHubAvecCookie(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const reponse = await fetchImpl(url, { ...init, redirect: "manual" });
  if (!REDIRECTIONS_SUIVIES.has(reponse.status)) return reponse;
  const emplacement = reponse.headers.get("location");
  if (!emplacement) return reponse;
  let cible: URL;
  try {
    cible = new URL(emplacement, url);
  } catch {
    return reponse;
  }
  if (!memeSiteAuWwwPres(new URL(url), cible)) return reponse;
  return fetchImpl(cible.toString(), { ...init, redirect: "manual" });
}
