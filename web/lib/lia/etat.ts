// lib/lia/etat.ts — l'état PARTAGÉ de LIA, vu de l'app (PUR : aucun réseau, aucun jeton).
//
// Une seule LIA, un seul état (Marc, 23/10/2026) : MemoryAI le garde, le hub le relaie (`GET|PUT /api/lia/etat`, avec la
// session de l'utilisateur) et l'app le relaie à sa page par sa propre route de même origine (`etatHttp("/api/lia/etat")`
// de lia-ui). Ce module ne fait que JUGER ce qui passe dans les deux sens, comme le fait le hub (Hubperso
// `lib/liaEtatPartage.ts`) avec la même fonction que LIA applique (`validerEtat`) :
//   - ce que la page ÉCRIT : trop gros = 413, hors contrat = 400, sinon l'état nettoyé est relayé ;
//   - ce que le hub RÉPOND : un 200 (ou un 409 d'écriture) n'est rendu que s'il est un état valide ; jamais réparé.
// L'état porte des nombres, des verbes de LIA et un nom d'humeur ; depuis lia-ui v0.39.0 il peut aussi porter la fin de la
// discussion (`discussion` : 20 messages de 600 caractères au plus, 4 000 au total, texte de Marc compris), relayée sans être lue.

import { validerEtat, type EtatLia } from "@mokarade/lia-ui";

/** Au-delà, 413 avant même de lire le JSON (contrat : 16 Ko, la limite de MemoryAI et du hub). */
export const TAILLE_MAX_ETAT = 16 * 1024;

export type MethodeEtat = "GET" | "PUT";

export type LectureCorps =
  | { ok: true; etat: EtatLia }
  | { ok: false; status: 400 | 413; error: string };

/** Lit le corps BRUT d'un PUT de la page. Le refus ne cite jamais une valeur reçue. */
export function lireCorpsEtat(brut: string): LectureCorps {
  if (new TextEncoder().encode(brut).length > TAILLE_MAX_ETAT) {
    return { ok: false, status: 413, error: "payload_too_large" };
  }
  let json: unknown;
  try {
    json = JSON.parse(brut);
  } catch {
    return { ok: false, status: 400, error: "bad_request" };
  }
  const etat = validerEtat(json);
  return etat ? { ok: true, etat } : { ok: false, status: 400, error: "bad_request" };
}

/** Ce que la route rend à la page : un statut et un corps JSON (`null` = aucun corps, comme un 204). */
export interface Relais {
  status: number;
  corps: unknown;
}

const indisponible: Relais = { status: 503, corps: { error: "unavailable" } };

/**
 * Traduit la réponse du hub en réponse pour la page. `brut` est le corps lu tel quel (texte) : un JSON illisible ou un état
 * hors contrat ne passe pas. Les refus d'accès du hub (401 sans accès, 403 invité, 429 trop vite) sont rendus tels quels ;
 * tout le reste devient 503 (LIA garde alors son état local).
 */
export function relayerReponseEtat(methode: MethodeEtat, statut: number, brut: string): Relais {
  if (methode === "GET" && statut === 204) return { status: 204, corps: null };

  if (statut === 200 || (methode === "PUT" && statut === 409)) {
    let json: unknown;
    try {
      json = JSON.parse(brut);
    } catch {
      return indisponible;
    }
    const etat = validerEtat(json);
    if (etat) return { status: statut, corps: etat };
    // 409 sans état gardé exploitable : la page garde le sien et réessaiera.
    if (statut === 409) return { status: 409, corps: { error: "version_depassee" } };
    return indisponible;
  }

  if (methode === "PUT" && (statut === 400 || statut === 413)) {
    return { status: statut, corps: { error: statut === 400 ? "bad_request" : "payload_too_large" } };
  }
  if (statut === 401) return { status: 401, corps: { error: "unauthenticated" } };
  if (statut === 403) return { status: 403, corps: { error: "forbidden" } };
  if (statut === 429) return { status: 429, corps: { error: "too_many_requests" } };
  return indisponible;
}
