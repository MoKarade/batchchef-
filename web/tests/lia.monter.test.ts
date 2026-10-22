// tests/lia.monter.test.ts — LIA n'est montée que pour une session admise.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSession, NonAutorise } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  NonAutorise: class NonAutorise extends Error {},
}));
vi.mock("@/lib/lia/session", () => ({ requireSession, NonAutorise }));

import { liaAutorisee } from "../lib/lia/monter";

beforeEach(() => {
  requireSession.mockReset();
});

describe("liaAutorisee", () => {
  it("session admise : vrai", async () => {
    requireSession.mockResolvedValue({ email: "marc@exemple.test" });
    expect(await liaAutorisee()).toBe(true);
  });

  it("pas de session (page de connexion) : faux", async () => {
    requireSession.mockRejectedValue(new NonAutorise());
    expect(await liaAutorisee()).toBe(false);
  });

  it("toute autre erreur remonte", async () => {
    requireSession.mockRejectedValue(new Error("panne"));
    await expect(liaAutorisee()).rejects.toThrow("panne");
  });
});
