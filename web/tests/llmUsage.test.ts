// Coût d'un appel LLM depuis les tokens (tarif du modèle).

import { describe, expect, it } from "vitest";
import { MULT_ECRITURE_CACHE, MULT_LECTURE_CACHE, costUsd, tarifPourModele } from "../lib/llmUsage";

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

describe("costUsd — cache de prompts", () => {
  const sonnet = tarifPourModele("claude-sonnet-5"); // 3 $/MTok en entrée

  it("une écriture de cache coûte 1,25 × l'entrée, une lecture 0,1 ×", () => {
    expect(MULT_ECRITURE_CACHE).toBe(1.25);
    expect(MULT_LECTURE_CACHE).toBe(0.1);
    expect(costUsd(0, 0, sonnet, { ecriture: 1_000_000 })).toBeCloseTo(3 * 1.25, 6);
    expect(costUsd(0, 0, sonnet, { lecture: 1_000_000 })).toBeCloseTo(3 * 0.1, 6);
  });

  it("les jetons de cache s'ajoutent à l'entrée et à la sortie, ils ne les remplacent pas", () => {
    // 1 000 entrée + 8 000 lus + 2 000 écrits + 500 sortie
    const attendu = (1_000 * 3 + 8_000 * 3 * 0.1 + 2_000 * 3 * 1.25) / 1e6 + (500 * 15) / 1e6;
    expect(costUsd(1_000, 500, sonnet, { ecriture: 2_000, lecture: 8_000 })).toBeCloseTo(attendu, 6);
  });

  it("une lecture de cache coûte MOINS que les mêmes jetons plein tarif — c'est le but", () => {
    expect(costUsd(0, 0, sonnet, { lecture: 8_000 })).toBeLessThan(costUsd(8_000, 0, sonnet));
  });

  it("champs absents ou null = zéro, et l'appel sans cache ne change pas", () => {
    expect(costUsd(1_000, 500, sonnet, { ecriture: null, lecture: undefined })).toBe(costUsd(1_000, 500, sonnet));
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
