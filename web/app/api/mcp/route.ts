// POST /api/mcp — serveur MCP de BatchChef (JSON-RPC 2.0 sur HTTP).
//
// Décisions de Marc (19/08/2026) : serveur DISTANT hébergé ici, et outils en LECTURE ET
// ÉCRITURE.
//
// Sécurité, calquée sur /api/hub/summary parce que c'est le même problème — une MACHINE
// appelle, elle n'a pas de cookie :
//   - MCP_TOKEN absent en env → 503 (intégration désactivée, jamais « ouvert par défaut ») ;
//   - jeton absent / mauvais  → 401, comparaison à TEMPS CONSTANT ;
//   - méthode ≠ POST          → 405 ;
//   - réponse toujours `no-store`.
//
// ⚠️ Cette route DOIT rester hors de la garde de session (`lib/authGuard.ts`). Sous le
// middleware, elle renverrait une redirection HTML vers /login au lieu du JSON-RPC : Claude
// verrait un serveur muet, sans qu'aucune erreur ne l'explique. C'est le piège n°1 du
// squelette de l'écosystème, déjà payé par JobAI.
//
// ⚠️ Le serveur est SANS ÉTAT : pas de session MCP, pas d'identifiant à conserver entre les
// requêtes. C'est ce que le serverless impose, et ça simplifie — chaque requête porte tout
// ce qu'il faut pour être traitée.

import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  ERREUR,
  erreur,
  estNotification,
  estRequeteValide,
  negocierVersion,
  reponse,
  VERSION_PROTOCOLE,
  type ReponseJsonRpc,
} from "@/lib/mcp/protocole";
import { OUTILS_MCP } from "@/lib/mcp/declarations";
import { executerOutilMcp } from "@/lib/mcp/outils";

export const dynamic = "force-dynamic";
// Une création de batch enchaîne une estimation de prix par LLM : le défaut de la
// plateforme couperait au milieu.
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" } as const;

/** Comparaison à temps constant : deux jetons de longueurs différentes ne doivent pas se
 *  distinguer par la durée. Le hachage égalise les longueurs avant la comparaison. */
function jetonsIdentiques(fourni: string, attendu: string): boolean {
  const a = createHash("sha256").update(fourni).digest();
  const b = createHash("sha256").update(attendu).digest();
  return timingSafeEqual(a, b);
}

function jetonDeLaRequete(request: Request): string {
  const auth = request.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  // En-tête de repli : certains clients ne laissent pas poser `Authorization`.
  return request.headers.get("x-mcp-token")?.trim() ?? "";
}

async function traiter(requete: unknown): Promise<ReponseJsonRpc | null> {
  if (!estRequeteValide(requete)) {
    return erreur(null, ERREUR.requeteInvalide, "Requête JSON-RPC invalide.");
  }
  // ⚠️ Une NOTIFICATION n'attend AUCUNE réponse (`notifications/initialized` arrive juste
  // après la poignée de main). Y répondre est une violation de protocole.
  if (estNotification(requete)) return null;

  const id = requete.id ?? null;
  const params = requete.params ?? {};

  switch (requete.method) {
    case "initialize":
      return reponse(id, {
        protocolVersion: negocierVersion(params.protocolVersion),
        capabilities: { tools: {} },
        serverInfo: { name: "batchchef", version: "1.0.0" },
      });

    case "ping":
      return reponse(id, {});

    case "tools/list":
      return reponse(id, { tools: OUTILS_MCP });

    case "tools/call": {
      const nom = params.name;
      if (typeof nom !== "string") {
        return erreur(id, ERREUR.parametresInvalides, "`name` manquant.");
      }
      const args =
        typeof params.arguments === "object" && params.arguments !== null
          ? (params.arguments as Record<string, unknown>)
          : {};
      return reponse(id, await executerOutilMcp(nom, args));
    }

    default:
      return erreur(id, ERREUR.methodeInconnue, `Méthode inconnue : ${requete.method}.`);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const attendu = process.env.MCP_TOKEN?.trim();
  if (!attendu) {
    return NextResponse.json(
      { error: "MCP_TOKEN non configuré côté BatchChef." },
      { status: 503, headers: NO_STORE },
    );
  }
  if (!jetonsIdentiques(jetonDeLaRequete(request), attendu)) {
    return NextResponse.json({ error: "Jeton invalide." }, { status: 401, headers: NO_STORE });
  }

  let corps: unknown;
  try {
    corps = await request.json();
  } catch {
    return NextResponse.json(
      erreur(null, ERREUR.parsing, "Corps JSON illisible."),
      { status: 200, headers: NO_STORE },
    );
  }

  // Un LOT (tableau) est prévu par JSON-RPC : les notifications y sont filtrées, et un lot
  // entièrement composé de notifications ne rend aucun corps (204).
  if (Array.isArray(corps)) {
    const reponses = (await Promise.all(corps.map(traiter))).filter(
      (r): r is ReponseJsonRpc => r !== null,
    );
    if (reponses.length === 0) return new NextResponse(null, { status: 204, headers: NO_STORE });
    return NextResponse.json(reponses, { status: 200, headers: NO_STORE });
  }

  const res = await traiter(corps);
  if (res === null) return new NextResponse(null, { status: 204, headers: NO_STORE });
  return NextResponse.json(res, { status: 200, headers: NO_STORE });
}

/** Toute autre méthode : 405 explicite, avec la version de protocole pour le diagnostic. */
export function GET(): NextResponse {
  return NextResponse.json(
    { error: "POST uniquement (JSON-RPC).", protocole: VERSION_PROTOCOLE },
    { status: 405, headers: NO_STORE },
  );
}
