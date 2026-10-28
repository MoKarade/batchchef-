// lib/llmUsage.ts — comptabilise le coût des appels LLM (bloc `usage` du summary hub).
// Enregistrement best-effort : la télémétrie ne doit JAMAIS interrompre un parse/estimation.

import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** Tarif d'un modèle, en USD par million de tokens. */
export interface Tarif {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Lecture de cache, multiple du tarif d'entrée (défaut `MULT_LECTURE_CACHE`). */
  lectureCache?: number;
}

// Tarif par défaut : Haiku 5.5 (le modèle du parse texte), override possible via env.
const TARIF_DEFAUT: Tarif = {
  inputPerMTok: Number(process.env.BATCHCHEF_LLM_PRICE_IN ?? 0.1),
  outputPerMTok: Number(process.env.BATCHCHEF_LLM_PRICE_OUT ?? 0.5),
};

// L'app n'appelle plus un seul modèle : le parse texte tourne sur Haiku, la lecture d'une
// vidéo sur un modèle vision. Facturer les deux au même tarif SOUS-ESTIMERAIT le coût publié
// au hub — un chiffre faux, pas une approximation. D'où cette table, indexée par PRÉFIXE
// d'identifiant. Seule la famille 5.5 est appelée : les anciens modèles ne sont plus dans le code, et
// le coût de chaque ligne passée est stocké déjà chiffré (rien à recalculer).
// Source : platform.claude.com/docs/en/about-claude/pricing, lue le 28/10/2026. Haiku 5.5 : grille des
// prompts de 100 000 jetons ou moins (au-delà : 0,50 $ / 2,50 $ ; aucun appel de l'app n'y approche).
const TARIFS: ReadonlyArray<readonly [string, Tarif]> = [
  ["claude-haiku-5-5", { inputPerMTok: 0.1, outputPerMTok: 0.5 }],
  ["claude-sonnet-5-5", { inputPerMTok: 2, outputPerMTok: 10, lectureCache: 0.05 }],
  ["claude-opus-5-5", { inputPerMTok: 4, outputPerMTok: 20, lectureCache: 0.05 }],
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

// Cache de prompts (tarif Anthropic) : une ÉCRITURE de cache coûte 1,25 × le tarif d'entrée
// (durée de vie de 5 minutes, celle qu'on utilise), une LECTURE 0,1 ×. Ces jetons ne sont PAS
// inclus dans `input_tokens` : les ignorer sous-estimerait le coût publié au hub (un chiffre
// faux), et les compter plein tarif le surestimerait.
export const MULT_ECRITURE_CACHE = 1.25;
export const MULT_LECTURE_CACHE = 0.1;

/** Jetons de cache d'un appel (absents ou `null` = 0). */
export interface JetonsCache {
  ecriture?: number | null;
  lecture?: number | null;
}

/** Coût USD d'un appel à partir des tokens (fonction pure, testable). */
export function costUsd(
  inputTokens: number,
  outputTokens: number,
  tarif: Tarif = TARIF_DEFAUT,
  cache: JetonsCache = {},
): number {
  const ecriture = cache.ecriture ?? 0;
  const lecture = cache.lecture ?? 0;
  const c =
    (inputTokens / 1e6) * tarif.inputPerMTok +
    (ecriture / 1e6) * tarif.inputPerMTok * MULT_ECRITURE_CACHE +
    (lecture / 1e6) * tarif.inputPerMTok * (tarif.lectureCache ?? MULT_LECTURE_CACHE) +
    (outputTokens / 1e6) * tarif.outputPerMTok;
  return Math.round(c * 1e6) / 1e6; // 6 décimales : les fractions de cent comptent
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/**
 * D'où vient l'appel — « video » = lecture d'images extraites d'une vidéo, « assistant » =
 * un tour de la boucle du chatbot. Une question de l'assistant en produit PLUSIEURS : c'est
 * le prix de le laisser fouiller la base lui-même, et c'est pour ça qu'on les compte.
 */
export type LlmAction = "parse" | "verify" | "estimate" | "video" | "assistant";

/** Enregistre un appel LLM. Best-effort : avale ses propres erreurs (jamais bloquant). */
export async function recordLlmUsage(
  action: LlmAction,
  usage: AnthropicUsage | null | undefined,
  model: string,
): Promise<void> {
  try {
    const inputTokens = usage?.input_tokens ?? 0;
    const outputTokens = usage?.output_tokens ?? 0;
    const cache: JetonsCache = {
      ecriture: usage?.cache_creation_input_tokens,
      lecture: usage?.cache_read_input_tokens,
    };
    // Une ligne par appel : seule trace en production du modèle réellement appelé et du cache
    // (la table ne stocke ni l'un ni l'autre). Aucun contenu, que des nombres et l'id du modèle.
    console.info(
      `[llmUsage] ${action} modele=${model} entree=${inputTokens} sortie=${outputTokens} ` +
        `cache écrit=${cache.ecriture ?? 0} lu=${cache.lecture ?? 0}`,
    );
    await db.insert(schema.llmUsage).values({
      action,
      // Tout ce qui est parti au modèle en entrée : le cache en fait partie, il est seulement facturé moins cher.
      inputTokens: inputTokens + (cache.ecriture ?? 0) + (cache.lecture ?? 0),
      outputTokens,
      costUsd: costUsd(inputTokens, outputTokens, tarifPourModele(model), cache),
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
