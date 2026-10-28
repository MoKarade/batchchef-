// `recordLlmUsage` enregistre le cache de prompts aux bons tarifs (lib/llmUsage.ts).
//
// ⚠️ La base est SIMULÉE : on éprouve ce que la fonction écrit, pas Drizzle. Les nombres
// d'`usage` sont des valeurs de test, jamais une mesure de production.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const values = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { insert: () => ({ values: (...a: unknown[]) => values(...a) }) },
  schema: { llmUsage: {} },
}));

import { recordLlmUsage } from "@/lib/llmUsage";

beforeEach(() => {
  values.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordLlmUsage — cache de prompts", () => {
  it("compte lecture et écriture de cache aux tarifs du cache, et garde le volume d'entrée entier", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await recordLlmUsage(
      "assistant",
      {
        input_tokens: 1_000,
        output_tokens: 500,
        cache_creation_input_tokens: 2_000,
        cache_read_input_tokens: 8_000,
      },
      "claude-sonnet-5",
    );
    expect(values).toHaveBeenCalledTimes(1);
    const ligne = values.mock.calls[0]![0] as Record<string, unknown>;
    expect(ligne.inputTokens).toBe(11_000);
    expect(ligne.outputTokens).toBe(500);
    // Sonnet : 3 $/MTok en entrée, 15 $/MTok en sortie.
    const attendu = (1_000 * 3 + 2_000 * 3 * 1.25 + 8_000 * 3 * 0.1) / 1e6 + (500 * 15) / 1e6;
    expect(ligne.costUsd).toBeCloseTo(attendu, 6);
  });

  it("laisse une trace de `lu` en production : c'est elle qui prouve le cache", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await recordLlmUsage(
      "assistant",
      { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 7_000 },
      "claude-sonnet-5",
    );
    expect(info).toHaveBeenCalledWith("[llmUsage] assistant cache écrit=0 lu=7000");
  });

  it("sans cache : même ligne qu'avant, et aucune trace", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await recordLlmUsage("parse", { input_tokens: 1_000_000, output_tokens: 0 }, "claude-haiku-4-5");
    expect(info).not.toHaveBeenCalled();
    expect(values.mock.calls[0]![0]).toEqual({
      action: "parse",
      inputTokens: 1_000_000,
      outputTokens: 0,
      costUsd: 1,
    });
  });

  it("champs de cache à null (réponse sans cache) : traités comme zéro", async () => {
    await recordLlmUsage(
      "assistant",
      { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: null, cache_read_input_tokens: null },
      "claude-sonnet-5",
    );
    expect((values.mock.calls[0]![0] as Record<string, unknown>).inputTokens).toBe(100);
  });
});
