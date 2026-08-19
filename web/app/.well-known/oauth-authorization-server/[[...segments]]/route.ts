// RFC 8414 — métadonnées du serveur d'autorisation : où sont `authorize`, `token`,
// `register`, et ce que le serveur sait faire. Claude lit ce document juste après celui de
// la ressource protégée.
//
// ⚠️ Même attrape-tout que son voisin : la variante path-aware est sondée aussi.

import { NextResponse } from "next/server";
import { etatOAuth } from "@/lib/mcp/oauthConfig";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function GET(): NextResponse {
  const { fournisseur, motif } = etatOAuth();
  if (!fournisseur) {
    return NextResponse.json({ error: motif }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json(fournisseur.metadonneesServeur(), { headers: NO_STORE });
}
