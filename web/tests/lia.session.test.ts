// tests/lia.session.test.ts — la garde de session de LIA : sans session, NonAutorise ; avec, l'adresse.

import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth }));

import { NonAutorise, requireSession } from "../lib/lia/session";

beforeEach(() => auth.mockReset());

describe("requireSession (LIA)", () => {
  it("sans session : NonAutorise", async () => {
    auth.mockResolvedValue(null);
    await expect(requireSession()).rejects.toBeInstanceOf(NonAutorise);
  });

  it("session sans utilisateur : NonAutorise", async () => {
    auth.mockResolvedValue({});
    await expect(requireSession()).rejects.toBeInstanceOf(NonAutorise);
  });

  it("session valide : rend l'adresse", async () => {
    auth.mockResolvedValue({ user: { email: "marc@exemple.test" } });
    await expect(requireSession()).resolves.toEqual({ email: "marc@exemple.test" });
  });

  it("session sans adresse : chaîne vide (jamais propriétaire)", async () => {
    auth.mockResolvedValue({ user: {} });
    await expect(requireSession()).resolves.toEqual({ email: "" });
  });
});
