// Coût d'un appel LLM depuis les tokens (tarif du modèle).

import { describe, expect, it } from "vitest";
import { costUsd, tarifPourModele } from "../lib/llmUsage";

describe("costUsd", () => {
  it("applique le tarif input/output par million de tokens", () => {
    // défaut : 1 $/MTok input, 5 $/MTok output
    expect(costUsd(1_000_000, 0)).toBeCloseTo(1.0, 6);
    expect(costUsd(0, 1_000_000)).toBeCloseTo(5.0, 6);
    expect(costUsd(500_000, 200_000)).toBeCloseTo(0.5 + 0.2 * 5, 6);
  });

  it("zéro token → zéro coût", () => {
    expect(costUsd(0, 0)).toBe(0);
  });

  it("applique le tarif du modèle RÉELLEMENT appelé", () => {
    // Le parse texte et la lecture vidéo ne tournent pas sur le même modèle : facturer les
    // deux au tarif d'Haiku sous-estimerait le coût publié au hub.
    const vision = tarifPourModele("claude-sonnet-5");
    expect(costUsd(1_000_000, 0, vision)).toBeCloseTo(3.0, 6);
    expect(costUsd(0, 1_000_000, vision)).toBeCloseTo(15.0, 6);
  });
});

describe("tarifPourModele", () => {
  it("reconnaît un identifiant daté par son préfixe", () => {
    expect(tarifPourModele("claude-haiku-4-5-20251001")).toEqual({
      inputPerMTok: 1,
      outputPerMTok: 5,
    });
  });

  it("distingue les familles (un tarif vision ≠ un tarif Haiku)", () => {
    expect(tarifPourModele("claude-sonnet-5").inputPerMTok).toBe(3);
    expect(tarifPourModele("claude-opus-5").inputPerMTok).toBe(5);
  });

  it("modèle inconnu → tarif par défaut (supposition assumée, jamais un plantage)", () => {
    expect(tarifPourModele("modele-inconnu")).toEqual({ inputPerMTok: 1, outputPerMTok: 5 });
    expect(tarifPourModele(null)).toEqual({ inputPerMTok: 1, outputPerMTok: 5 });
  });
});
