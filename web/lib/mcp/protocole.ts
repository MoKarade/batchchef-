// Le protocole MCP, en JSON-RPC 2.0 — la partie qui se décide SANS base ni réseau.
//
// Pourquoi PAS le SDK officiel en production. `@modelcontextprotocol/sdk` embarque express,
// hono, cors, jose et treize autres dépendances (8,7 Mo) pour fournir un transport HTTP —
// dans une app Next qui a déjà le sien. Et son transport Streamable HTTP gère des SESSIONS,
// là où une fonction serverless est sans état par construction. On garde donc le SDK en
// devDependency pour la VÉRITÉ (cf. le tripwire de `tests/mcp.test.ts`, qui compare nos
// constantes aux siennes et échoue si elles divergent) et on écrit ici un dispatcheur pur,
// testable, de la taille du besoin.

/**
 * Versions du protocole. ⚠️ Copiées du SDK 1.30.0 et VERROUILLÉES par tripwire — si le SDK
 * bouge et que ces valeurs ne suivent pas, `tests/mcp.test.ts` échoue. Sans ce verrou, une
 * constante recopiée vieillit en silence, exactement comme les listes de colonnes de JobAI.
 */
export const VERSION_PROTOCOLE = "2025-11-25";
export const VERSIONS_SUPPORTEES = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
  "2024-10-07",
] as const;
export const VERSION_JSONRPC = "2.0";

/** Codes d'erreur JSON-RPC standards. */
export const ERREUR = {
  requeteInvalide: -32600,
  methodeInconnue: -32601,
  parametresInvalides: -32602,
  interne: -32603,
  parsing: -32700,
} as const;

export interface RequeteJsonRpc {
  jsonrpc: string;
  /** Absent = NOTIFICATION : aucune réponse ne doit être renvoyée. */
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface ReponseJsonRpc {
  jsonrpc: string;
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export function estRequeteValide(v: unknown): v is RequeteJsonRpc {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return r.jsonrpc === VERSION_JSONRPC && typeof r.method === "string";
}

/**
 * Une NOTIFICATION est une requête sans `id` : le protocole interdit d'y répondre.
 *
 * ⚠️ `notifications/initialized` arrive juste après la poignée de main. Y répondre — même
 * un succès vide — est une violation que certains clients traitent en erreur de protocole.
 * Le distinguer par l'ABSENCE de la clé, pas par `id === null` : `null` est un id valide.
 */
export function estNotification(r: RequeteJsonRpc): boolean {
  return !("id" in r) || r.id === undefined;
}

/**
 * Version à annoncer au client.
 *
 * On rend CELLE QU'IL DEMANDE si on la connaît — c'est la négociation prévue par le
 * protocole, et imposer la nôtre couperait un client plus ancien. Version inconnue ou
 * absente : on annonce la nôtre et il décide.
 */
export function negocierVersion(demandee: unknown): string {
  return typeof demandee === "string" &&
    (VERSIONS_SUPPORTEES as readonly string[]).includes(demandee)
    ? demandee
    : VERSION_PROTOCOLE;
}

export function reponse(id: string | number | null, result: unknown): ReponseJsonRpc {
  return { jsonrpc: VERSION_JSONRPC, id, result };
}

export function erreur(id: string | number | null, code: number, message: string): ReponseJsonRpc {
  return { jsonrpc: VERSION_JSONRPC, id, error: { code, message } };
}

/**
 * Résultat d'un outil, au format MCP.
 *
 * `isError` plutôt qu'une erreur JSON-RPC : un outil qui échoue n'est pas un protocole
 * cassé. Le modèle reçoit le motif et peut reformuler, là où une erreur de transport
 * interromprait toute la conversation.
 */
export function resultatOutil(texte: string, echec = false): Record<string, unknown> {
  return { content: [{ type: "text", text: texte }], isError: echec };
}
