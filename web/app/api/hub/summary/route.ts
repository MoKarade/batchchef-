// GET /api/hub/summary — endpoint consommé par le hub perso (hubperso.com).
//
// Sécurité : jeton partagé `x-hub-token` (fail-closed). Pas de session Google ici — le
// hub est une machine, pas un navigateur ; il présente un secret d'en-tête à la place.
//   - HUB_TOKEN absent en env  → 503 (mal configuré, jamais « ouvert par défaut »).
//   - jeton absent / mauvais   → 401 (comparaison à temps constant, pas de fuite de timing).
//   - erreur d'agrégation      → 200 avec status "error" (le hub affiche un état honnête,
//                                pas un 500 opaque qui clignote « injoignable »).
//
// Cette route DOIT rester hors de la garde de session du middleware (cf. lib/authGuard.ts) :
// le hub y accède par jeton, pas par login. Les données restent server-side.
//
// ── CE QUI EST DÉLÉGUÉ, ET CE QUI NE PEUT PAS L'ÊTRE ─────────────────────────────────
//
// Les trois premières lignes du contrat ci-dessus (503/401/405), la comparaison en temps
// constant, `no-store` et la validation avant émission viennent de `serveSummary`
// (`@mokarade/hub-contract/endpoint`), écrite une fois pour toutes les apps.
//
// La QUATRIÈME, non : `serveSummary` répond **500 si son `build` JETTE**. Le contrat de
// BatchChef dit 200 + `status: "error"`, pour que le hub affiche « impossible de lire
// l'état » plutôt qu'un « injoignable » qui accuse le réseau. C'est pourquoi
// `construireResume` ci-dessous **n'a pas le droit de jeter** : son `catch` EST le contrat.
// Le retirer en croyant que le helper s'en charge changerait le diagnostic affiché à Marc
// le jour d'une panne — c'est-à-dire le seul jour où ça compte.

import { CONTRACT_VERSION, type HubSummary } from "@mokarade/hub-contract";
import { HUB_TOKEN_HEADER, serveSummary } from "@mokarade/hub-contract/endpoint";
import { buildBatchchefSummary, publicUrl } from "@/lib/hubSummary";

// Toujours dynamique, jamais mis en cache : le hub veut l'état courant.
export const dynamic = "force-dynamic";

/** ⚠️ NE JETTE JAMAIS — voir l'en-tête. Une panne devient un summary `status: "error"`. */
async function construireResume(): Promise<HubSummary> {
  try {
    return await buildBatchchefSummary();
  } catch (err) {
    // Erreur honnête : status "error" en 200 (le hub sait l'afficher sans clignoter).
    console.error("[hub/summary] échec d'agrégation :", err);
    const base = publicUrl();
    return {
      // `CONTRACT_VERSION` et non `1` en dur : le jour d'un bump, une constante suit et un
      // littéral ment. Ce payload-ci ne s'exécute qu'en panne, donc personne ne le verrait
      // diverger avant qu'il ne serve.
      contractVersion: CONTRACT_VERSION,
      app: { id: "batchchef", name: "BatchChef", url: base, color: "#c2410c" },
      generatedAt: new Date().toISOString(),
      status: "error",
      metrics: [],
      alerts: [{ label: "Impossible de lire l'état BatchChef.", severity: "alert" }],
      actions: [{ label: "Ouvrir BatchChef", kind: "link", href: base }],
    };
  }
}

export async function GET(request: Request): Promise<Response> {
  const { status, headers, body } = await serveSummary(
    { method: "GET", token: request.headers.get(HUB_TOKEN_HEADER) },
    { expectedToken: process.env.HUB_TOKEN?.trim(), build: construireResume },
  );
  return new Response(body, { status, headers });
}
