// tests/lia.demarrage.test.ts — LIA se monte partout sauf sur la page de connexion.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { demarrerLia } = vi.hoisted(() => ({ demarrerLia: vi.fn() }));
vi.mock("@mokarade/lia-ui/boot", () => ({ demarrerLia }));

import { demarrerLiaApp, sansLia } from "../lib/lia/demarrage";

beforeEach(() => {
  demarrerLia.mockReset();
});

describe("sansLia", () => {
  it("la page de connexion n'a pas de LIA", () => {
    expect(sansLia("/login")).toBe(true);
    expect(sansLia("/login/")).toBe(true);
  });

  it("toute autre page en a une (jamais un préfixe de chaîne)", () => {
    for (const chemin of ["/", "/recettes", "/assistant", "/loginfo", "/batchs/42"]) {
      expect(sansLia(chemin)).toBe(false);
    }
  });
});

describe("demarrerLiaApp", () => {
  it("démarre LIA avec un ask sur une page connectée", () => {
    demarrerLiaApp("/recettes");
    expect(demarrerLia).toHaveBeenCalledTimes(1);
    expect(typeof demarrerLia.mock.calls[0]?.[0]?.ask).toBe("function");
  });

  it("ne démarre rien sur /login", () => {
    demarrerLiaApp("/login");
    expect(demarrerLia).not.toHaveBeenCalled();
  });
});
