// Page de consentement OAuth : la seule chose que Marc voit au branchement du connecteur.
//
// GET  → un formulaire où il colle sa clé d'accès (= `MCP_TOKEN`).
// POST → vérifie la clé, puis redirige vers Claude avec le code d'autorisation.
//
// ⚠️ C'est la seule porte DEVINABLE du serveur : partout ailleurs il faut déjà une
// signature HMAC valide. D'où le plafond de tentatives, en base (cf. `oauthPlafond.ts`).
//
// ⚠️ Le HTML est écrit ici, à la main, et pas avec le socle visuel de l'app : cette page
// est servie hors du rendu React (une Route Handler), et surtout elle doit rester lisible
// même si tout le reste casse. Elle suit `prefers-color-scheme` comme le reste de l'app —
// on n'impose pas le thème sombre.

import { NextResponse } from "next/server";
import { ErreurOAuth } from "@/lib/mcp/oauth";
import { etatOAuth } from "@/lib/mcp/oauthConfig";
import { noterEchec, porteFermee, PLAFOND_ECHECS } from "@/lib/mcp/oauthPlafond";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const HTML = { "Content-Type": "text/html; charset=utf-8", ...NO_STORE } as const;

/** Neutralise le HTML : ces valeurs viennent de la requête, elles ne sont pas de confiance. */
function echapper(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(champs: Record<string, string>, erreur?: string): string {
  const caches = Object.entries(champs)
    .map(([n, v]) => `<input type="hidden" name="${echapper(n)}" value="${echapper(v)}">`)
    .join("\n      ");
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Connecter Claude à BatchChef</title>
  <style>
    :root { color-scheme: light dark; --fond:#faf8f5; --encre:#1c1917; --doux:#6b6560;
            --bord:#e0dbd4; --accent:#c2410c; --erreur:#b91c1c; --carte:#ffffff; }
    @media (prefers-color-scheme: dark) {
      :root { --fond:#1c1917; --encre:#f5f1ec; --doux:#a8a29e; --bord:#3a3532;
              --accent:#fb923c; --erreur:#f87171; --carte:#262220; }
    }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100dvh; display:grid; place-items:center; padding:24px;
           background:var(--fond); color:var(--encre);
           font:16px/1.55 ui-sans-serif, system-ui, -apple-system, sans-serif; }
    main { width:100%; max-width:26rem; background:var(--carte); border:1px solid var(--bord);
           border-radius:14px; padding:28px 26px; }
    h1 { margin:0 0 6px; font-size:1.3rem; font-family:ui-serif, Georgia, serif; }
    p { margin:0 0 18px; color:var(--doux); font-size:.94rem; }
    label { display:block; font-size:.85rem; font-weight:600; margin-bottom:7px; }
    input[type=password] { width:100%; padding:12px 13px; font-size:16px; color:var(--encre);
      background:var(--fond); border:1px solid var(--bord); border-radius:9px; }
    button { width:100%; margin-top:16px; padding:13px; min-height:44px; font-size:1rem;
      font-weight:600; color:#fff; background:var(--accent); border:0; border-radius:9px;
      cursor:pointer; }
    .erreur { margin:0 0 16px; padding:11px 13px; border-radius:9px; font-size:.9rem;
      color:var(--erreur); border:1px solid var(--erreur); background:transparent; }
  </style>
</head>
<body>
  <main>
    <h1>Connecter Claude à BatchChef</h1>
    <p>Colle ta clé d'accès&nbsp;: c'est la valeur de <code>MCP_TOKEN</code>, celle posée dans
       les variables d'environnement Vercel.</p>
    ${erreur ? `<p class="erreur">${echapper(erreur)}</p>` : ""}
    <form method="POST">
      ${caches}
      <label for="cle">Clé d'accès</label>
      <input id="cle" name="cle" type="password" autocomplete="off" autofocus required>
      <button type="submit">Autoriser</button>
    </form>
  </main>
</body>
</html>`;
}

/** Les paramètres à reconduire du GET vers le POST, tels quels. */
const PARAMS = ["client_id", "redirect_uri", "code_challenge", "code_challenge_method", "response_type", "state", "scope"];

function reponseErreur(err: unknown): NextResponse {
  if (err instanceof ErreurOAuth) {
    return NextResponse.json(
      { error: err.code, error_description: err.message },
      { status: err.status, headers: NO_STORE },
    );
  }
  throw err;
}

export function GET(request: Request): NextResponse {
  const { fournisseur, motif } = etatOAuth();
  if (!fournisseur) return NextResponse.json({ error: motif }, { status: 503, headers: NO_STORE });

  const q = new URL(request.url).searchParams;
  try {
    fournisseur.validerDemandeAutorisation({
      response_type: q.get("response_type") ?? undefined,
      client_id: q.get("client_id") ?? undefined,
      redirect_uri: q.get("redirect_uri") ?? undefined,
      code_challenge: q.get("code_challenge") ?? undefined,
      code_challenge_method: q.get("code_challenge_method") ?? undefined,
    });
  } catch (err) {
    return reponseErreur(err);
  }

  const champs: Record<string, string> = {};
  for (const p of PARAMS) {
    const v = q.get(p);
    if (v !== null) champs[p] = v;
  }
  return new NextResponse(page(champs), { headers: HTML });
}

export async function POST(request: Request): Promise<NextResponse> {
  const { fournisseur, motif } = etatOAuth();
  if (!fournisseur) return NextResponse.json({ error: motif }, { status: 503, headers: NO_STORE });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Formulaire illisible." },
      { status: 400, headers: NO_STORE },
    );
  }
  const lire = (n: string): string => {
    const v = form.get(n);
    return typeof v === "string" ? v : "";
  };

  const champs: Record<string, string> = {};
  for (const p of PARAMS) {
    const v = lire(p);
    if (v) champs[p] = v;
  }

  const maintenant = new Date();
  // Le plafond vit en base. Si la base ne répond pas, on FERME — un plafond qui s'ouvre
  // quand son compteur tombe en panne ne protège rien, et c'est exactement le moment où
  // quelqu'un le ferait tomber. Le message dit ce qui se passe : sans lui, Marc reçoit un
  // 500 nu au moment précis où il essaie de se connecter, et rien ne lui indique que ce
  // n'est pas sa clé.
  let ferme: boolean;
  try {
    ferme = await porteFermee(maintenant);
  } catch {
    return new NextResponse(
      page(champs, "La base ne répond pas : impossible de vérifier le plafond de tentatives, donc l'autorisation est refusée par prudence. Réessaie dans un moment."),
      { status: 503, headers: HTML },
    );
  }
  if (ferme) {
    // Volontairement une page, pas une redirection : c'est Marc qui regarde, et il doit
    // comprendre que ce n'est pas sa clé qui est en cause mais le plafond.
    return new NextResponse(
      page(champs, `Trop de tentatives ratées (${PLAFOND_ECHECS} par heure). Réessaie à l'heure suivante.`),
      { status: 429, headers: HTML },
    );
  }

  try {
    fournisseur.validerDemandeAutorisation({
      response_type: lire("response_type"),
      client_id: lire("client_id"),
      redirect_uri: lire("redirect_uri"),
      code_challenge: lire("code_challenge"),
      code_challenge_method: lire("code_challenge_method"),
    });
    const code = fournisseur.autoriser({
      clientId: lire("client_id"),
      redirectUri: lire("redirect_uri"),
      codeChallenge: lire("code_challenge"),
      cleFournie: lire("cle"),
    });
    const cible = new URL(lire("redirect_uri"));
    cible.searchParams.set("code", code);
    const state = lire("state");
    if (state) cible.searchParams.set("state", state);
    return NextResponse.redirect(cible.toString(), { status: 302, headers: NO_STORE });
  } catch (err) {
    if (err instanceof ErreurOAuth && err.code === "access_denied") {
      await noterEchec(maintenant);
      // On réaffiche le formulaire : une redirection perdrait les paramètres et Marc
      // devrait recommencer tout le branchement pour une faute de frappe.
      return new NextResponse(page(champs, "Clé d'accès invalide."), { status: 403, headers: HTML });
    }
    return reponseErreur(err);
  }
}
