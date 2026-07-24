// Coût d'un appel LLM depuis les tokens (tarif du modèle).

import { describe, expect, it } from "vitest";
import { costUsd } from "../lib/llmUsage";

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
});
