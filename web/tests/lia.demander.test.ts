// tests/lia.demander.test.ts — l'appel serveur vers le hub échoue FERMÉ.

import { describe, expect, it, vi } from "vitest";
import { LiaIndisponible, demanderAuHub } from "../lib/lia/demander";

const demande = { question: "Où en est mon budget ?", page: "/budget" };
const env = { HUB_TOKEN: "jeton-de-test" };
const ok = (corps: unknown) => vi.fn(async () => Response.json(corps));

describe("demanderAuHub", () => {
  it("poste la question avec le jeton de l'app, SANS identifiant d'app dans le corps", async () => {
    const fetchImpl = ok({ text: "Voilà.", mood: "calme" });
    const rendu = await demanderAuHub(demande, { fetchImpl, env });
    expect(rendu).toEqual({ text: "Voilà.", mood: "calme" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hubperso.com/api/lia/ask");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-hub-token"]).toBe("jeton-de-test");
    expect(JSON.parse(init.body as string)).toEqual({ ...demande, proprietaire: false });
    expect(init.cache).toBe("no-store");
  });

  it("dit au hub si la session est celle du propriétaire (faux par défaut)", async () => {
    const fetchImpl = ok({ text: "x" });
    await demanderAuHub(demande, { fetchImpl, env, proprietaire: true });
    await demanderAuHub(demande, { fetchImpl, env });
    const corps = fetchImpl.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
    expect(corps[0]).toEqual({ ...demande, proprietaire: true });
    expect(corps[1]).toEqual({ ...demande, proprietaire: false });
  });

  it("sans HUB_TOKEN : indisponible, et aucun appel réseau", async () => {
    const fetchImpl = ok({ text: "x" });
    await expect(demanderAuHub(demande, { fetchImpl, env: {} })).rejects.toBeInstanceOf(LiaIndisponible);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["http://hubperso.com", "pas une url"])("refuse l'URL `%s` (https obligatoire)", async (url) => {
    const fetchImpl = ok({ text: "x" });
    await expect(
      demanderAuHub(demande, { fetchImpl, env: { HUB_TOKEN: "t", NEXT_PUBLIC_HUB_URL: url } }),
    ).rejects.toBeInstanceOf(LiaIndisponible);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("Le hub répond autre chose que 2xx : indisponible", async () => {
    const fetchImpl = vi.fn(async () => new Response("non", { status: 401 }));
    await expect(demanderAuHub(demande, { fetchImpl, env })).rejects.toThrow(/401/);
  });

  it("corps illisible ou non conforme : indisponible, jamais une réponse inventée", async () => {
    const illisible = vi.fn(async () => new Response("pas du json", { status: 200 }));
    await expect(demanderAuHub(demande, { fetchImpl: illisible, env })).rejects.toBeInstanceOf(LiaIndisponible);
    await expect(demanderAuHub(demande, { fetchImpl: ok({ mood: "calme" }), env })).rejects.toBeInstanceOf(
      LiaIndisponible,
    );
  });

  it("réseau en panne : indisponible", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(demanderAuHub(demande, { fetchImpl, env })).rejects.toBeInstanceOf(LiaIndisponible);
  });

  it("l'annulation par le navigateur est relayée telle quelle, pas déguisée en panne", async () => {
    const controle = new AbortController();
    const fetchImpl = vi.fn(async () => {
      controle.abort();
      throw new DOMException("annulé", "AbortError");
    });
    await expect(demanderAuHub(demande, { fetchImpl, env, signal: controle.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
