// lib/llmUsage.ts — comptabilise le coût des appels LLM (bloc `usage` du summary hub).
// Enregistrement best-effort : la télémétrie ne doit JAMAIS interrompre un parse/estimation.

import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// Tarif du modèle par million de tokens (USD). Défaut : Haiku 4.5 (approximatif —
// override possible via env si le tarif change). Le coût affiché reste une estimation.
const PRICE = {
  inputPerMTok: Number(process.env.BATCHCHEF_LLM_PRICE_IN ?? 1.0),
  outputPerMTok: Number(process.env.BATCHCHEF_LLM_PRICE_OUT ?? 5.0),
};

/** Coût USD d'un appel à partir des tokens (fonction pure, testable). */
export function costUsd(inputTokens: number, outputTokens: number): number {
  const c = (inputTokens / 1e6) * PRICE.inputPerMTok + (outputTokens / 1e6) * PRICE.outputPerMTok;
  return Math.round(c * 1e6) / 1e6; // 6 décimales : les fractions de cent comptent
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}

/** Enregistre un appel LLM. Best-effort : avale ses propres erreurs (jamais bloquant). */
export async function recordLlmUsage(
  action: "parse" | "verify" | "estimate",
  usage: AnthropicUsage | null | undefined,
): Promise<void> {
  try {
    const inputTokens = usage?.input_tokens ?? 0;
    const outputTokens = usage?.output_tokens ?? 0;
    await db.insert(schema.llmUsage).values({
      action,
      inputTokens,
      outputTokens,
      costUsd: costUsd(inputTokens, outputTokens),
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
