// RFC 9728 — métadonnées de la ressource protégée. C'est le document que le `WWW-Authenticate`
// du 401 fait découvrir, et le point de départ du branchement d'un connecteur claude.ai.
//
// ⚠️ Segment OPTIONNEL et attrape-tout (`[[...segments]]`) : les clients MCP sondent la
// variante « path-aware » (`/.well-known/oauth-protected-resource/api/mcp`) autant que la
// racine, et l'échec de découverte est silencieux — le connecteur dit juste qu'il n'a pas
// réussi. Servir les deux coûte un fichier ; n'en servir qu'un se paie en diagnostic.

import { NextResponse } from "next/server";
import { etatOAuth } from "@/lib/mcp/oauthConfig";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function GET(): NextResponse {
  const { fournisseur, motif } = etatOAuth();
  if (!fournisseur) {
    // 503 et non 404 : l'OAuth n'est pas ABSENT, il est ÉTEINT — et le motif le dit.
    return NextResponse.json({ error: motif }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json(fournisseur.metadonneesRessource(), { headers: NO_STORE });
}
