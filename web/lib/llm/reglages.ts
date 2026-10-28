// lib/llm/reglages.ts — réglages d'appel propres à chaque génération de modèle.
//
// POURQUOI : la pensée est activée par défaut sur la famille 5.5 et elle COMPTE dans `max_tokens`.
// Un parse de recette ou un tour d'assistant qui pense longtemps coûte des jetons de sortie et
// peut être coupé avant la réponse. On règle donc l'effort explicitement, par modèle.
//
// Un modèle inconnu (variable d'environnement qui pointe ailleurs) ne reçoit AUCUN réglage :
// mieux vaut un appel au comportement par défaut qu'un 400 sur un paramètre qu'il ne connaît pas.

type Effort = "low" | "medium" | "high";

export interface ReglagesModele {
  thinking?: { type: "disabled" };
  output_config?: { effort: Effort };
}

/**
 * Extraction à la chaîne (parse, vérification, prix) sur Haiku : pas de réflexion, `disabled` est accepté
 * à effort ≤ high. Sur Sonnet / Opus (lecture de vidéo, plus dure), la pensée adaptative RESTE : on la
 * borne seulement par l'effort. (`disabled` y est refusé : 400.)
 */
export function reglagesExtraction(modele: string): ReglagesModele {
  const id = modele.trim().toLowerCase();
  if (id.startsWith("claude-haiku-5-5")) {
    return { thinking: { type: "disabled" }, output_config: { effort: "low" } };
  }
  if (id.startsWith("claude-sonnet-5-5") || id.startsWith("claude-opus-5-5")) {
    return { output_config: { effort: "medium" } };
  }
  return {};
}

/** Conversation avec outils (assistant) : la pensée adaptative reste, bornée par un effort bas. */
export function reglagesConversation(modele: string): ReglagesModele {
  const id = modele.trim().toLowerCase();
  if (id.startsWith("claude-haiku-5-5") || id.startsWith("claude-sonnet-5-5") || id.startsWith("claude-opus-5-5")) {
    return { output_config: { effort: "low" } };
  }
  return {};
}
