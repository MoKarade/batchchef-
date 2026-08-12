// lib/llmUsage.ts — comptabilise le coût des appels LLM (bloc `usage` du summary hub).
// Enregistrement best-effort : la télémétrie ne doit JAMAIS interrompre un parse/estimation.

import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** Tarif d'un modèle, en USD par million de tokens. */
export interface Tarif {
  inputPerMTok: number;
  outputPerMTok: number;
}

// Tarif par défaut : Haiku 4.5 (le modèle du parse texte), override possible via env.
const TARIF_DEFAUT: Tarif = {
  inputPerMTok: Number(process.env.BATCHCHEF_LLM_PRICE_IN ?? 1.0),
  outputPerMTok: Number(process.env.BATCHCHEF_LLM_PRICE_OUT ?? 5.0),
};

// L'app n'appelle plus un seul modèle : le parse texte tourne sur Haiku, la lecture d'une
// vidéo sur un modèle vision. Facturer les deux au même tarif SOUS-ESTIMERAIT le coût publié
// au hub — un chiffre faux, pas une approximation. D'où cette table, indexée par PRÉFIXE
// d'identifiant (« claude-haiku-4-5-20251001 » tombe bien sur « claude-haiku-4-5 »).
const TARIFS: ReadonlyArray<readonly [string, Tarif]> = [
  ["claude-haiku-4-5", { inputPerMTok: 1, outputPerMTok: 5 }],
  ["claude-sonnet-5", { inputPerMTok: 3, outputPerMTok: 15 }],
  ["claude-sonnet-4-6", { inputPerMTok: 3, outputPerMTok: 15 }],
  ["claude-opus-5", { inputPerMTok: 5, outputPerMTok: 25 }],
  ["claude-opus-4-8", { inputPerMTok: 5, outputPerMTok: 25 }],
];

/**
 * Tarif d'un modèle. Modèle inconnu → tarif par défaut : c'est une SUPPOSITION, assumée
 * (le hub publie ce coût comme une estimation). Ajouter une ligne ci-dessus dès qu'un
 * nouveau modèle est utilisé, sinon son coût est compté à celui d'Haiku.
 */
export function tarifPourModele(model: string | null | undefined): Tarif {
  const id = (model ?? "").trim().toLowerCase();
  for (const [prefixe, tarif] of TARIFS) {
    if (id.startsWith(prefixe)) return tarif;
  }
  return TARIF_DEFAUT;
}

/** Coût USD d'un appel à partir des tokens (fonction pure, testable). */
export function costUsd(
  inputTokens: number,
  outputTokens: number,
  tarif: Tarif = TARIF_DEFAUT,
): number {
  const c = (inputTokens / 1e6) * tarif.inputPerMTok + (outputTokens / 1e6) * tarif.outputPerMTok;
  return Math.round(c * 1e6) / 1e6; // 6 décimales : les fractions de cent comptent
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}

/** D'où vient l'appel — « video » = lecture d'images extraites d'une vidéo. */
export type LlmAction = "parse" | "verify" | "estimate" | "video";

/** Enregistre un appel LLM. Best-effort : avale ses propres erreurs (jamais bloquant). */
export async function recordLlmUsage(
  action: LlmAction,
  usage: AnthropicUsage | null | undefined,
  model: string,
): Promise<void> {
  try {
    const inputTokens = usage?.input_tokens ?? 0;
    const outputTokens = usage?.output_tokens ?? 0;
    await db.insert(schema.llmUsage).values({
      action,
      inputTokens,
      outputTokens,
      costUsd: costUsd(inputTokens, outputTokens, tarifPourModele(model)),
    });
  } catch {
    // Télémétrie non bloquante — on n'échoue jamais un import à cause du log de coût.
  }
}

/**
 * Coût LLM cumulé en USD (arrondi au cent). BEST-EFFORT : si la table n'existe pas encore
 * (migration pas appliquée) ou toute autre panne, renvoie 0 — le coût est un BONUS, il ne
 * doit JAMAIS casser le summary hub (sinon le widget BatchChef entier tombe en « error »).
 */
export async function totalLlmCostUsd(): Promise<number> {
  try {
    const [row] = await db
      .select({ sum: sql<number>`coalesce(sum(${schema.llmUsage.costUsd}), 0)` })
      .from(schema.llmUsage);
    return Math.round(Number(row?.sum ?? 0) * 100) / 100;
  } catch {
    return 0;
  }
}
