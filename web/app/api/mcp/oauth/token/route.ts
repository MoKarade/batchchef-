// Endpoint de jetons OAuth 2.1 : `authorization_code` (avec PKCE) et `refresh_token`
// (avec rotation — l'ancien jeton est invalidé à chaque usage).

import { NextResponse } from "next/server";
import { ErreurOAuth } from "@/lib/mcp/oauth";
import { etatOAuth } from "@/lib/mcp/oauthConfig";
import { consommerJti, purgerJtiExpires } from "@/lib/mcp/oauthStore";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const texte = (v: FormDataEntryValue | null): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

export async function POST(request: Request): Promise<NextResponse> {
  const { fournisseur, motif } = etatOAuth();
  if (!fournisseur) return NextResponse.json({ error: motif }, { status: 503, headers: NO_STORE });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Corps form-urlencoded attendu." },
      { status: 400, headers: NO_STORE },
    );
  }

  const grant = texte(form.get("grant_type"));
  const clientId = texte(form.get("client_id"));
  const clientSecret = texte(form.get("client_secret"));

  try {
    if (!clientId) throw new ErreurOAuth("invalid_request", "client_id manquant.");

    if (grant === "authorization_code") {
      const code = texte(form.get("code"));
      const redirectUri = texte(form.get("redirect_uri"));
      const codeVerifier = texte(form.get("code_verifier"));
      if (!code || !redirectUri || !codeVerifier) {
        throw new ErreurOAuth("invalid_request", "code, redirect_uri et code_verifier requis.");
      }
      const jetons = await fournisseur.echangerCode(
        { code, clientId, clientSecret, redirectUri, codeVerifier },
        consommerJti,
      );
      void purgerJtiExpires();
      return NextResponse.json(jetons, { headers: NO_STORE });
    }

    if (grant === "refresh_token") {
      const refreshToken = texte(form.get("refresh_token"));
      if (!refreshToken) throw new ErreurOAuth("invalid_request", "refresh_token manquant.");
      const jetons = await fournisseur.rafraichir({ refreshToken, clientId, clientSecret }, consommerJti);
      return NextResponse.json(jetons, { headers: NO_STORE });
    }

    throw new ErreurOAuth(
      "unsupported_grant_type",
      "grant_type doit être authorization_code ou refresh_token.",
    );
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
