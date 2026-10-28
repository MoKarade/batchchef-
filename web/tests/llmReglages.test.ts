// Réglages d'appel par génération de modèle : la famille 5.5 pense par défaut et la pensée compte
// dans `max_tokens`. Un modèle inconnu ne reçoit aucun réglage (jamais un 400 sur un paramètre inconnu).

import { describe, expect, it } from "vitest";
import { reglagesConversation, reglagesExtraction } from "../lib/llm/reglages";

describe("reglagesExtraction", () => {
  it("Haiku 5.5 : pensée coupée, effort bas", () => {
    expect(reglagesExtraction("claude-haiku-5-5")).toEqual({
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
    });
  });

  it("Sonnet 5.5 : jamais `disabled` (400) ; la pensée adaptative reste, bornée par l'effort", () => {
    const r = reglagesExtraction("claude-sonnet-5-5");
    expect(r.thinking).toBeUndefined();
    expect(r.output_config).toEqual({ effort: "medium" });
  });

  it("modèle inconnu ou ancien : aucun réglage", () => {
    expect(reglagesExtraction("claude-haiku-4-5")).toEqual({});
    expect(reglagesExtraction("autre")).toEqual({});
  });
});

describe("reglagesConversation", () => {
  it("5.5 : effort bas, pensée adaptative conservée", () => {
    expect(reglagesConversation("claude-sonnet-5-5")).toEqual({ output_config: { effort: "low" } });
  });

  it("modèle inconnu : aucun réglage", () => {
    expect(reglagesConversation("autre")).toEqual({});
  });
});
