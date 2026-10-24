// tests/lia.demarrage.test.ts — LIA est sur toutes les pages ; sur /login (mode invité) son ask refuse avant tout réseau.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { demarrerLia } = vi.hoisted(() => ({ demarrerLia: vi.fn() }));
vi.mock("@mokarade/lia-ui/boot", () => ({ demarrerLia }));

import { creerAsk, demarrerLiaApp, enModeInvite } from "../lib/lia/demarrage";

const signal = new AbortController().signal;
const reponse = { reponse: "Bonjour" } as never;

beforeEach(() => {
  demarrerLia.mockReset();
  vi.unstubAllGlobals();
});

describe("enModeInvite", () => {
  it("la page de connexion est en mode invité", () => {
    expect(enModeInvite("/login")).toBe(true);
    expect(enModeInvite("/login/")).toBe(true);
  });

  it("toute autre page est connectée (jamais un préfixe de chaîne)", () => {
    for (const chemin of ["/", "/recettes", "/assistant", "/loginfo", "/batchs/42"]) {
      expect(enModeInvite(chemin)).toBe(false);
    }
  });
});

describe("creerAsk", () => {
  it("sur /login : rejette sans appeler ask (aucun réseau), pour que LIA dise « indisponible »", async () => {
    const ask = vi.fn().mockResolvedValue(reponse);
    await expect(creerAsk(ask, () => "/login")("Salut ?", signal)).rejects.toThrow("pas de session");
    expect(ask).not.toHaveBeenCalled();
  });

  it("ailleurs : délègue question et signal tels quels", async () => {
    const ask = vi.fn().mockResolvedValue(reponse);
    await expect(creerAsk(ask, () => "/recettes")("Salut ?", signal)).resolves.toBe(reponse);
    expect(ask).toHaveBeenCalledWith("Salut ?", signal);
  });

  it("relit la page à chaque appel : une déconnexion vers /login referme ask, une connexion le rouvre", async () => {
    const ask = vi.fn().mockResolvedValue(reponse);
    let page = "/recettes";
    const garde = creerAsk(ask, () => page);
    await expect(garde("1", signal)).resolves.toBe(reponse);
    page = "/login";
    await expect(garde("2", signal)).rejects.toThrow();
    page = "/";
    await expect(garde("3", signal)).resolves.toBe(reponse);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("une erreur d'ask connecté est propagée (échec fermé, jamais avalée)", async () => {
    const ask = vi.fn().mockRejectedValue(new Error("LIA indisponible (503)"));
    await expect(creerAsk(ask, () => "/")("?", signal)).rejects.toThrow("503");
  });
});

describe("demarrerLiaApp", () => {
  it.each(["/recettes", "/login"])("démarre LIA sur %s (présente partout)", (chemin) => {
    vi.stubGlobal("window", { location: { pathname: chemin } });
    demarrerLiaApp();
    expect(demarrerLia).toHaveBeenCalledTimes(1);
    expect(typeof demarrerLia.mock.calls[0]?.[0]?.ask).toBe("function");
  });
});
