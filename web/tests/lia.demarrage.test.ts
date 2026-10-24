// tests/lia.demarrage.test.ts — LIA est sur toutes les pages ; sur /login (mode invité) son ask refuse avant tout réseau.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { demarrerLia } = vi.hoisted(() => ({ demarrerLia: vi.fn() }));
vi.mock("@mokarade/lia-ui/boot", () => ({ demarrerLia }));
const { etatHttp } = vi.hoisted(() => ({ etatHttp: vi.fn() }));
vi.mock("@mokarade/lia-ui/etat-http", () => ({ etatHttp }));

import { creerAsk, creerEtat, creerPause, demarrerLiaApp, enModeInvite, sonderPause } from "../lib/lia/demarrage";

const signal = new AbortController().signal;
const reponse = { reponse: "Bonjour" } as never;

beforeEach(() => {
  demarrerLia.mockReset();
  etatHttp.mockReset().mockReturnValue({ lire: async () => null, ecrire: async () => null });
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

describe("creerPause", () => {
  it("connecté : la pause du suivi, telle quelle (en pause tant qu'on ne sait pas)", () => {
    expect(creerPause({ enPause: () => true }, () => "/recettes")()).toBe(true);
    expect(creerPause({ enPause: () => false }, () => "/recettes")()).toBe(false);
  });

  it("sur /login : jamais en pause (aucun appel n'y part, aucune session pour lire la pause)", () => {
    expect(creerPause({ enPause: () => true }, () => "/login")()).toBe(false);
  });

  it("relit la page à chaque appel", () => {
    let page = "/login";
    const pause = creerPause({ enPause: () => true }, () => page);
    expect(pause()).toBe(false);
    page = "/";
    expect(pause()).toBe(true);
  });
});

describe("sonderPause", () => {
  const suivi = (doitRelire: boolean) => ({ doitRelire: vi.fn(() => doitRelire), rafraichir: vi.fn(async () => undefined) });

  it("lit tout de suite, puis à chaque pas du minuteur tant qu'il le faut", () => {
    const s = suivi(true);
    let pas = () => undefined as void;
    sonderPause(s, () => "/", (tache) => { pas = tache; });
    expect(s.rafraichir).toHaveBeenCalledTimes(1);
    pas();
    expect(s.rafraichir).toHaveBeenCalledTimes(2);
  });

  it("lecture encore fraîche : pas d'appel", () => {
    const s = suivi(false);
    sonderPause(s, () => "/", () => undefined);
    expect(s.rafraichir).not.toHaveBeenCalled();
  });

  it("sur /login : aucun appel (pas de session) ; il reprend après la connexion", () => {
    const s = suivi(true);
    let page = "/login";
    let pas = () => undefined as void;
    sonderPause(s, () => page, (tache) => { pas = tache; });
    pas();
    expect(s.rafraichir).not.toHaveBeenCalled();
    page = "/";
    pas();
    expect(s.rafraichir).toHaveBeenCalledTimes(1);
  });
});

describe("creerEtat", () => {
  const etat = { version: 1 } as never;

  it("sur une page connectée : délègue lire et ecrire à l'hôte, tels quels", async () => {
    const hote = { lire: vi.fn().mockResolvedValue("lu"), ecrire: vi.fn().mockResolvedValue("ecrit") };
    const enveloppe = creerEtat(hote, () => "/recettes");
    await expect(enveloppe.lire()).resolves.toBe("lu");
    await expect(enveloppe.ecrire(etat)).resolves.toBe("ecrit");
    expect(hote.ecrire).toHaveBeenCalledWith(etat);
  });

  it("sur /login : aucun état chez l'hôte et aucun appel réseau (pas de session)", async () => {
    const hote = { lire: vi.fn(), ecrire: vi.fn() };
    const enveloppe = creerEtat(hote, () => "/login");
    await expect(enveloppe.lire()).resolves.toBeNull();
    await expect(enveloppe.ecrire(etat)).resolves.toBeNull();
    expect(hote.lire).not.toHaveBeenCalled();
    expect(hote.ecrire).not.toHaveBeenCalled();
  });

  it("la page est relue à chaque appel (déconnexion sans rechargement complet)", async () => {
    const hote = { lire: vi.fn().mockResolvedValue("lu"), ecrire: vi.fn() };
    let chemin = "/recettes";
    const enveloppe = creerEtat(hote, () => chemin);
    await enveloppe.lire();
    chemin = "/login";
    await expect(enveloppe.lire()).resolves.toBeNull();
    expect(hote.lire).toHaveBeenCalledTimes(1);
  });
});

describe("demarrerLiaApp", () => {
  it("branche l'état partagé sur la route de même origine /api/lia/etat", async () => {
    vi.stubGlobal("window", { location: { pathname: "/recettes" } });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ pause: false })));
    const lire = vi.fn().mockResolvedValue("etat du hub");
    etatHttp.mockReturnValue({ lire, ecrire: vi.fn() });
    demarrerLiaApp(() => undefined);
    expect(etatHttp).toHaveBeenCalledWith("/api/lia/etat");
    await expect(demarrerLia.mock.calls[0]?.[0]?.etat.lire()).resolves.toBe("etat du hub");
  });

  it.each(["/recettes", "/login"])("démarre LIA sur %s (présente partout) avec ask ET pause", (chemin) => {
    vi.stubGlobal("window", { location: { pathname: chemin } });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ pause: false })));
    demarrerLiaApp(() => undefined);
    expect(demarrerLia).toHaveBeenCalledTimes(1);
    expect(typeof demarrerLia.mock.calls[0]?.[0]?.ask).toBe("function");
    expect(typeof demarrerLia.mock.calls[0]?.[0]?.pause).toBe("function");
  });

  it("avant toute lecture de la pause, LIA connectée est en pause ; sur /login non", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Promise<Response>(() => undefined)));
    vi.stubGlobal("window", { location: { pathname: "/recettes" } });
    demarrerLiaApp(() => undefined);
    expect(demarrerLia.mock.calls[0]?.[0]?.pause()).toBe(true);
    demarrerLia.mockReset();
    vi.stubGlobal("window", { location: { pathname: "/login" } });
    demarrerLiaApp(() => undefined);
    expect(demarrerLia.mock.calls[0]?.[0]?.pause()).toBe(false);
  });
});
