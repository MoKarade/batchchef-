// lib/authGuard.ts — logique de garde du middleware en fonctions pures (testables).

export type GuardDecision =
  | { type: "next" }
  | { type: "unauthorized" }
  | { type: "redirect"; location: string };

/** Routes publiques : Auth.js, login, endpoint hub (jeton), assets Next. Le reste exige une session. */
/** Le chemin est-il CE chemin, ou un segment sous lui ? (`/a` et `/a/b`, jamais `/a-b`.) */
function estSousChemin(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function isPublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (pathname.startsWith("/api/auth/")) return true;
  // Endpoint hub : gardé par jeton x-hub-token dans la route, pas par session Google.
  if (pathname === "/api/hub/summary") return true;
  // Endpoint MCP : gardé par jeton `MCP_TOKEN` dans la route. Comme le hub, c'est une
  // MACHINE qui appelle — elle n'a pas de cookie de session à présenter. Laissé sous la
  // garde de session, il recevrait une redirection HTML vers /login au lieu du JSON-RPC,
  // et Claude verrait un serveur muet sans qu'aucune erreur ne le dise.
  // ⚠️ ÉGALITÉ STRICTE, jamais un préfixe : une future route sous /api/mcp/ ne doit pas
  // hériter de l'exemption sans qu'on l'ait décidé.
  if (pathname === "/api/mcp") return true;
  // Les trois portes OAuth du MCP. Chacune NOMMÉE : la route qu'on écrira demain sous
  // /api/mcp/ doit retomber du côté gardé tant que personne n'a décidé le contraire.
  if (pathname === "/api/mcp/oauth/register") return true;
  if (pathname === "/api/mcp/oauth/authorize") return true;
  if (pathname === "/api/mcp/oauth/token") return true;
  // Les deux documents de découverte OAuth (RFC 9728 / RFC 8414).
  //
  // ⚠️ Ici, et ici SEULEMENT, l'exemption couvre les sous-chemins — parce que les clients
  // MCP sondent aussi la variante « path-aware » (…/oauth-protected-resource/api/mcp) et
  // qu'un seul attrape-tout les sert TOUS. Il n'existe donc aucune route future qui
  // pourrait apparaître dessous sans qu'on édite ce handler : le risque que l'égalité
  // stricte évite ailleurs n'existe pas ici.
  //
  // C'est un préfixe de SEGMENT, pas de chaîne : `…-resource/x` passe, `…-resource-evil`
  // NON. Un `startsWith` nu aurait exempté le second.
  if (estSousChemin(pathname, "/.well-known/oauth-protected-resource")) return true;
  if (estSousChemin(pathname, "/.well-known/oauth-authorization-server")) return true;
  if (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/_next/image") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.webmanifest"
  ) {
    return true;
  }
  const lastSegment = pathname.split("/").pop() ?? "";
  return lastSegment.includes(".");
}

export function decideGuard(params: {
  isAuthenticated: boolean;
  pathname: string;
  search?: string;
}): GuardDecision {
  const { isAuthenticated, pathname, search = "" } = params;
  if (isPublicPath(pathname) || isAuthenticated) return { type: "next" };
  if (pathname.startsWith("/api/")) return { type: "unauthorized" };
  const callbackUrl = encodeURIComponent(pathname + search);
  return { type: "redirect", location: `/login?callbackUrl=${callbackUrl}` };
}
