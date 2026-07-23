// GET /api/hub/summary — endpoint consommé par le hub perso (hubperso.com).
//
// Sécurité : jeton partagé `x-hub-token` (fail-closed). Pas de session Google ici — le
// hub est une machine, pas un navigateur ; il présente un secret d'en-tête à la place.
//   - HUB_TOKEN absent en env  → 503 (mal configuré, jamais « ouvert par défaut »).
//   - jeton absent / mauvais   → 401 (comparaison à temps constant, pas de fuite de timing).
//   - erreur d'agrégation       → 200 avec status "error" (le hub affiche un état honnête,
//                                 pas un 500 opaque qui clignote « injoignable »).
//
// Cette route DOIT rester hors de la garde de session du middleware (cf. lib/authGuard.ts) :
// le hub y accède par jeton, pas par login. Les données restent server-side.

import { NextResponse } from "next/server";
import { HUB_TOKEN_HEADER } from "@mokarade/hub-contract";
import { buildBatchchefSummary, publicUrl } from "@/lib/hubSummary";
import { hubTokensMatch } from "@/lib/hubToken";

// Toujours dynamique, jamais mis en cache : le hub veut l'état courant.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" } as const;

export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.HUB_TOKEN?.trim();
  if (!expected) {
    // Fail-closed : sans jeton configuré, on refuse — jamais d'exposition par défaut.
    return NextResponse.json(
      { error: "HUB_TOKEN non configuré côté BatchChef." },
      { status: 503, headers: NO_STORE },
    );
  }

  const provided = request.headers.get(HUB_TOKEN_HEADER)?.trim() ?? "";
  if (!hubTokensMatch(provided, expected)) {
    return NextResponse.json({ error: "Jeton invalide." }, { status: 401, headers: NO_STORE });
  }

  try {
    const summary = await buildBatchchefSummary();
    return NextResponse.json(summary, { status: 200, headers: NO_STORE });
  } catch (err) {
    // Erreur honnête : status "error" en 200 (le hub sait l'afficher sans clignoter).
    console.error("[hub/summary] échec d'agrégation :", err);
    const base = publicUrl();
    return NextResponse.json(
      {
        contractVersion: 1,
        app: { id: "batchchef", name: "BatchChef", url: base, color: "#c2410c" },
        generatedAt: new Date().toISOString(),
        status: "error",
        metrics: [],
        alerts: [{ label: "Impossible de lire l'état BatchChef.", severity: "alert" }],
        actions: [{ label: "Ouvrir BatchChef", kind: "link", href: base }],
      },
      { status: 200, headers: NO_STORE },
    );
  }
}
