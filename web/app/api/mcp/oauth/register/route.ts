// RFC 7591 — enregistrement dynamique de client. Claude s'enregistre tout seul avant le
// premier branchement ; il n'y a rien à créer à la main.
//
// SANS STOCKAGE : le `client_secret` est HMAC(client_id), donc toute instance serverless
// peut le re-dériver et le vérifier sans base.

import { NextResponse } from "next/server";
import { ErreurOAuth } from "@/lib/mcp/oauth";
import { etatOAuth } from "@/lib/mcp/oauthConfig";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request): Promise<NextResponse> {
  const { fournisseur, motif } = etatOAuth();
  if (!fournisseur) return NextResponse.json({ error: motif }, { status: 503, headers: NO_STORE });

  let corps: unknown;
  try {
    corps = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: "Corps JSON illisible." },
      { status: 400, headers: NO_STORE },
    );
  }
  const o = typeof corps === "object" && corps !== null ? (corps as Record<string, unknown>) : {};
  const uris = Array.isArray(o.redirect_uris)
    ? o.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];

  try {
    return NextResponse.json(fournisseur.enregistrerClient(uris), { status: 201, headers: NO_STORE });
  } catch (err) {
    if (err instanceof ErreurOAuth) {
      return NextResponse.json(
        { error: err.code, error_description: err.message },
        { status: err.status, headers: NO_STORE },
      );
    }
    throw err;
  }
}
