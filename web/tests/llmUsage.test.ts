// Coût d'un appel LLM depuis les tokens (tarif du modèle).

import { describe, expect, it } from "vitest";
import { MULT_ECRITURE_CACHE, MULT_LECTURE_CACHE, costUsd, tarifPourModele } from "../lib/llmUsage";

describe("costUsd", () => {
  it("applique le tarif input/output par million de tokens", () => {
    // défaut (Haiku 5.5) : 0,10 $/MTok input, 0,50 $/MTok output
    expect(costUsd(1_000_000, 0)).toBeCloseTo(0.1, 6);
    expect(costUsd(0, 1_000_000)).toBeCloseTo(0.5, 6);
    expect(costUsd(500_000, 200_000)).toBeCloseTo(0.05 + 0.2 * 0.5, 6);
  });

  it("zéro token → zéro coût", () => {
    expect(costUsd(0, 0)).toBe(0);
  });

  it("applique le tarif du modèle RÉELLEMENT appelé", () => {
    // Le parse texte et la lecture vidéo ne tournent pas sur le même modèle : facturer les
    // deux au tarif d'Haiku sous-estimerait le coût publié au hub.
    const vision = tarifPourModele("claude-sonnet-5-5");
    expect(costUsd(1_000_000, 0, vision)).toBeCloseTo(2.0, 6);
    expect(costUsd(0, 1_000_000, vision)).toBeCloseTo(10.0, 6);
  });
});

describe("costUsd — cache de prompts", () => {
  const sonnet = tarifPourModele("claude-sonnet-5-5"); // 2 $/MTok en entrée, lecture de cache 0,10 $ (×0,05)
  const haiku = tarifPourModele("claude-haiku-5-5"); // lecture de cache ×0,1

  it("une écriture de cache coûte 1,25 × l'entrée ; une lecture 0,05 × (Sonnet 5.5) ou 0,1 × (Haiku 5.5)", () => {
    expect(MULT_ECRITURE_CACHE).toBe(1.25);
    expect(MULT_LECTURE_CACHE).toBe(0.1);
    expect(costUsd(0, 0, sonnet, { ecriture: 1_000_000 })).toBeCloseTo(2 * 1.25, 6);
    expect(costUsd(0, 0, sonnet, { lecture: 1_000_000 })).toBeCloseTo(0.1, 6);
    expect(costUsd(0, 0, haiku, { lecture: 1_000_000 })).toBeCloseTo(0.01, 6);
  });

  it("les jetons de cache s'ajoutent à l'entrée et à la sortie, ils ne les remplacent pas", () => {
    // 1 000 entrée + 8 000 lus + 2 000 écrits + 500 sortie
    const attendu = (1_000 * 2 + 8_000 * 2 * 0.05 + 2_000 * 2 * 1.25) / 1e6 + (500 * 10) / 1e6;
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
    expect(tarifPourModele("claude-haiku-5-5-20261001")).toEqual({
      inputPerMTok: 0.1,
      outputPerMTok: 0.5,
    });
  });

  it("distingue les familles (un tarif vision ≠ un tarif Haiku)", () => {
    expect(tarifPourModele("claude-sonnet-5-5").inputPerMTok).toBe(2);
    expect(tarifPourModele("claude-opus-5-5").inputPerMTok).toBe(4);
  });

  it("« claude-sonnet-5-5 » n'est pas rangé avec « claude-sonnet-5 » (ancien tarif 3 $/15 $)", () => {
    expect(tarifPourModele("claude-sonnet-5-5").outputPerMTok).toBe(10);
  });

  it("modèle inconnu → tarif par défaut (supposition assumée, jamais un plantage)", () => {
    expect(tarifPourModele("modele-inconnu")).toEqual({ inputPerMTok: 0.1, outputPerMTok: 0.5 });
    expect(tarifPourModele(null)).toEqual({ inputPerMTok: 0.1, outputPerMTok: 0.5 });
  });
});
