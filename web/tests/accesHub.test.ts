// tests/accesHub.test.ts — la question posée au hub, sans jamais toucher le réseau.
//
// `interroger` (la seule partie qui touche `fetch`) est injectée : ce fichier éprouve le
// cache et l'échec fermé, pas la connectivité. Les cas qui comptent sont ceux du REFUS —
// un accès accordé par erreur ne se voit pas, un refus injustifié se signale tout seul.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_ACCES_MS, aAccesHub, viderCacheAcces } from "../lib/accesHub";

const INVITEE = "quelquun@exemple.com";
const env = { HUB_TOKEN: "jeton-factice-de-test" };

beforeEach(() => {
  viderCacheAcces();
});

describe("aAccesHub", () => {
  it("refuse une adresse vide sans interroger le hub", async () => {
    const interroger = vi.fn();
    expect(await aAccesHub("", env, 0, interroger)).toBe(false);
    expect(interroger).not.toHaveBeenCalled();
  });

  it("refuse sans HUB_TOKEN configuré, sans interroger le hub", async () => {
    const interroger = vi.fn();
    expect(await aAccesHub(INVITEE, {}, 0, interroger)).toBe(false);
    expect(interroger).not.toHaveBeenCalled();
  });

  it("accorde quand le hub répond oui", async () => {
    const interroger = vi.fn(async () => true);
    expect(await aAccesHub(INVITEE, env, 0, interroger)).toBe(true);
    expect(interroger).toHaveBeenCalledWith("quelquun@exemple.com", "jeton-factice-de-test");
  });

  it("refuse quand le hub répond non", async () => {
    const interroger = vi.fn(async () => false);
    expect(await aAccesHub(INVITEE, env, 0, interroger)).toBe(false);
  });

  it("normalise l'adresse avant de l'envoyer", async () => {
    const interroger = vi.fn(async () => true);
    await aAccesHub("  Quelqu.Un@Exemple.COM ", env, 0, interroger);
    expect(interroger).toHaveBeenCalledWith("quelqu.un@exemple.com", "jeton-factice-de-test");
  });

  it("répond `false` si la requête échoue, sans laisser fuiter l'exception", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    const interroger = vi.fn(async () => {
      throw new Error("panne réseau");
    });
    expect(await aAccesHub(INVITEE, env, 0, interroger)).toBe(false);
    expect(erreur).toHaveBeenCalledOnce();
    erreur.mockRestore();
  });

  describe("le cache d'une minute", () => {
    it("mémorise un OUI et ne réinterroge pas le hub tant qu'il est valide", async () => {
      const interroger = vi.fn(async () => true);
      expect(await aAccesHub(INVITEE, env, 0, interroger)).toBe(true);
      interroger.mockResolvedValue(false);
      expect(await aAccesHub(INVITEE, env, CACHE_ACCES_MS - 1, interroger)).toBe(true);
      expect(interroger).toHaveBeenCalledOnce();
    });

    it("réinterroge le hub une fois le cache expiré", async () => {
      const interroger = vi.fn(async () => true);
      expect(await aAccesHub(INVITEE, env, 0, interroger)).toBe(true);
      interroger.mockResolvedValue(false);
      expect(await aAccesHub(INVITEE, env, CACHE_ACCES_MS, interroger)).toBe(false);
      expect(interroger).toHaveBeenCalledTimes(2);
    });

    it("NE mémorise JAMAIS un refus", async () => {
      const interroger = vi.fn(async () => false);
      expect(await aAccesHub(INVITEE, env, 0, interroger)).toBe(false);
      expect(await aAccesHub(INVITEE, env, 0, interroger)).toBe(false);
      expect(interroger).toHaveBeenCalledTimes(2);
    });
  });
});

// Le SEUL test qui touche la vraie construction de la requête (URL, en-tête, corps) —
// tout le reste ci-dessus injecte `interroger` pour éprouver le cache sans réseau.
describe("demanderAuHub (via fetch réel, simulé)", () => {
  it("poste le jeton en en-tête et l'adresse dans le corps, sur /api/acces du hub", async () => {
    const fetchSimule = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://hubperso.com/api/acces");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["x-hub-token"]).toBe("jeton-factice-de-test");
      expect(JSON.parse(String(init?.body))).toEqual({ email: "quelquun@exemple.com" });
      return new Response(JSON.stringify({ appId: "batchchef", acces: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSimule);

    expect(await aAccesHub(INVITEE, env, 0)).toBe(true);
    expect(fetchSimule).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it("refuse sur une réponse HTTP en erreur", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 401 })),
    );
    expect(await aAccesHub(INVITEE, env, 0)).toBe(false);
    vi.unstubAllGlobals();
  });
});
