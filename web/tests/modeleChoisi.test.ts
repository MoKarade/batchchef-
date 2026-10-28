// `modeleChoisi` : une variable d'environnement ne peut pas ramener un ancien modèle.

import { afterEach, describe, expect, it, vi } from "vitest";
import { estModele55, modeleChoisi } from "../lib/llm/modele";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("estModele55", () => {
  it("accepte les trois familles 5.5, datées ou non", () => {
    expect(estModele55("claude-haiku-5-5")).toBe(true);
    expect(estModele55("claude-sonnet-5-5")).toBe(true);
    expect(estModele55("claude-opus-5-5-20261001")).toBe(true);
    expect(estModele55("  Claude-Sonnet-5-5 ")).toBe(true);
  });

  it("refuse les anciennes générations, dont « claude-sonnet-5 » qui est un préfixe de « claude-sonnet-5-5 »", () => {
    expect(estModele55("claude-haiku-4-5")).toBe(false);
    expect(estModele55("claude-sonnet-4-6")).toBe(false);
    expect(estModele55("claude-sonnet-5")).toBe(false);
    expect(estModele55("claude-opus-4-1")).toBe(false);
    expect(estModele55("n'importe quoi")).toBe(false);
  });
});

describe("modeleChoisi", () => {
  it("variable absente ou vide : le défaut du code, sans bruit", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(modeleChoisi("X", undefined, "claude-haiku-5-5")).toBe("claude-haiku-5-5");
    expect(modeleChoisi("X", "   ", "claude-haiku-5-5")).toBe("claude-haiku-5-5");
    expect(warn).not.toHaveBeenCalled();
  });

  it("variable en 5.5 : elle l'emporte (on peut monter d'une famille sans toucher au code)", () => {
    expect(modeleChoisi("X", "claude-opus-5-5", "claude-haiku-5-5")).toBe("claude-opus-5-5");
  });

  it("variable sur un ancien modèle : écartée, défaut utilisé, et le journal le dit", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(modeleChoisi("BATCHCHEF_LLM_MODEL", "claude-haiku-4-5", "claude-haiku-5-5")).toBe("claude-haiku-5-5");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("BATCHCHEF_LLM_MODEL");
    expect(warn.mock.calls[0]![0]).toContain("claude-haiku-4-5");
  });
});
