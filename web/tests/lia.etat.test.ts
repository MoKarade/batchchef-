// tests/lia.etat.test.ts — l'état partagé de LIA : jugement (pur), lecture chez le hub (I/O simulée) et route de l'app.
// Échec fermé partout : rien n'est réparé, rien n'est inventé, rien n'atteint le hub sans session.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSession, NonAutorise } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  NonAutorise: class NonAutorise extends Error {},
}));
vi.mock("@/lib/lia/session", () => ({ requireSession, NonAutorise }));

import { GET, PUT } from "../app/api/lia/etat/route";
import { TAILLE_MAX_ETAT, lireCorpsEtat, relayerReponseEtat } from "../lib/lia/etat";
import { relayerEtatHub } from "../lib/lia/etatHub";

const etat = {
  version: 3,
  maj: 1761300000000,
  envies: { energie: 0.5, curiosite: 0.5, social: 0.5, inquiet: 0.1, joie: 0.6, ennui: 0.2 },
  journal: [],
  lente: {},
  humeur: "joyeux",
  relances: { jour: "2026-10-24", n: 1 },
};
const env = {};
const cookie = "authjs.session-token=abc";
const hub = (statut: number, corps?: unknown) =>
  vi.fn(async () => (corps === undefined ? new Response(null, { status: statut }) : Response.json(corps, { status: statut })));

describe("lireCorpsEtat", () => {
  it("un état conforme passe, nettoyé des clés inconnues", () => {
    const lu = lireCorpsEtat(JSON.stringify({ ...etat, secret: "x" }));
    expect(lu).toEqual({ ok: true, etat });
  });

  it("trop gros : 413 avant même de lire le JSON", () => {
    expect(lireCorpsEtat("x".repeat(TAILLE_MAX_ETAT + 1))).toEqual({ ok: false, status: 413, error: "payload_too_large" });
  });

  it("JSON illisible ou hors contrat : 400, sans citer la valeur reçue", () => {
    for (const brut of ["pas du json", "{}", JSON.stringify({ ...etat, humeur: 12 }), "null"]) {
      expect(lireCorpsEtat(brut)).toEqual({ ok: false, status: 400, error: "bad_request" });
    }
  });
});

describe("relayerReponseEtat", () => {
  it("GET 204 : aucun état, aucun corps", () => {
    expect(relayerReponseEtat("GET", 204, "")).toEqual({ status: 204, corps: null });
  });

  it("200 valide : l'état est rendu ; 409 valide (PUT) : l'état plus récent du hub", () => {
    expect(relayerReponseEtat("GET", 200, JSON.stringify(etat))).toEqual({ status: 200, corps: etat });
    expect(relayerReponseEtat("PUT", 409, JSON.stringify(etat))).toEqual({ status: 409, corps: etat });
  });

  it("200 illisible ou hors contrat : 503, jamais réparé", () => {
    for (const brut of ["pas du json", "{}", JSON.stringify({ ...etat, version: "3" })]) {
      expect(relayerReponseEtat("GET", 200, brut).status).toBe(503);
    }
  });

  it("409 sans état exploitable : version_depassee (LIA garde le sien)", () => {
    expect(relayerReponseEtat("PUT", 409, "{}")).toEqual({ status: 409, corps: { error: "version_depassee" } });
  });

  it("un 409 en GET n'existe pas : 503", () => {
    expect(relayerReponseEtat("GET", 409, JSON.stringify(etat)).status).toBe(503);
  });

  it("refus d'écriture 400 / 413 rendus ; 400 / 413 en lecture = 503", () => {
    expect(relayerReponseEtat("PUT", 400, "").status).toBe(400);
    expect(relayerReponseEtat("PUT", 413, "").status).toBe(413);
    expect(relayerReponseEtat("GET", 400, "").status).toBe(503);
  });

  it("401, 403 (invité), 429 rendus tels quels ; tout le reste (500, 503, 302…) devient 503", () => {
    expect(relayerReponseEtat("GET", 401, "").status).toBe(401);
    expect(relayerReponseEtat("GET", 403, "").status).toBe(403);
    expect(relayerReponseEtat("PUT", 429, "").status).toBe(429);
    for (const statut of [302, 404, 500, 502, 503]) expect(relayerReponseEtat("GET", statut, "").status).toBe(503);
  });
});

describe("relayerEtatHub", () => {
  it("GET : le cookie de session de l'utilisateur, https, sans cache, jamais de jeton d'app", async () => {
    const fetchImpl = hub(200, etat);
    await expect(relayerEtatHub("GET", cookie, { fetchImpl, env })).resolves.toEqual({ status: 200, corps: etat });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hubperso.com/api/lia/etat");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ cookie });
    expect(init.cache).toBe("no-store");
    expect(init.body).toBeUndefined();
  });

  it("PUT : le corps jugé part en JSON, avec le cookie", async () => {
    const fetchImpl = hub(200, etat);
    await relayerEtatHub("PUT", cookie, { corps: JSON.stringify(etat), fetchImpl, env });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({ cookie, "content-type": "application/json" });
    expect(init.body).toBe(JSON.stringify(etat));
  });

  it("pas de cookie : 503 et aucun appel réseau", async () => {
    const fetchImpl = hub(200, etat);
    await expect(relayerEtatHub("GET", null, { fetchImpl, env })).resolves.toMatchObject({ status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("réseau en panne, hub non https, hub qui rend du texte : 503, jamais d'exception", async () => {
    const panne = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(relayerEtatHub("GET", cookie, { fetchImpl: panne, env })).resolves.toMatchObject({ status: 503 });
    const fetchImpl = hub(200, etat);
    await expect(
      relayerEtatHub("GET", cookie, { fetchImpl, env: { NEXT_PUBLIC_HUB_URL: "http://hubperso.com" } }),
    ).resolves.toMatchObject({ status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(
      relayerEtatHub("GET", cookie, { fetchImpl: vi.fn(async () => new Response("<html>")), env }),
    ).resolves.toMatchObject({ status: 503 });
  });
});

describe("route /api/lia/etat", () => {
  const appeler = (methode: "GET" | "PUT", corps?: string, entetes: Record<string, string> = { cookie }) =>
    new Request("https://app.test/api/lia/etat", { method: methode, body: corps, headers: entetes });

  beforeEach(() => {
    requireSession.mockReset().mockResolvedValue({ email: "marc@exemple.test" });
    vi.unstubAllGlobals();
  });

  it("sans session : 401 en GET comme en PUT, et le hub n'est PAS appelé", async () => {
    const fetchImpl = hub(200, etat);
    vi.stubGlobal("fetch", fetchImpl);
    requireSession.mockRejectedValue(new NonAutorise());
    expect((await GET(appeler("GET"))).status).toBe(401);
    expect((await PUT(appeler("PUT", JSON.stringify(etat)))).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("une autre erreur que « non autorisé » n'est pas avalée", async () => {
    requireSession.mockRejectedValue(new Error("panne inattendue"));
    await expect(GET(appeler("GET"))).rejects.toThrow("panne inattendue");
  });

  it("GET : rend l'état du hub en no-store ; 204 sans corps", async () => {
    vi.stubGlobal("fetch", hub(200, etat));
    const res = await GET(appeler("GET"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(etat);
    vi.stubGlobal("fetch", hub(204));
    const vide = await GET(appeler("GET"));
    expect(vide.status).toBe(204);
    expect(await vide.text()).toBe("");
  });

  it("PUT : relaie l'état nettoyé ; 409 du hub rendu avec l'état plus récent", async () => {
    const fetchImpl = hub(409, { ...etat, version: 9 });
    vi.stubGlobal("fetch", fetchImpl);
    const res = await PUT(appeler("PUT", JSON.stringify({ ...etat, inconnu: 1 })));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { version: number }).version).toBe(9);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify(etat));
  });

  it("PUT hors contrat ou trop gros : 400 / 413 AVANT tout appel au hub", async () => {
    const fetchImpl = hub(200, etat);
    vi.stubGlobal("fetch", fetchImpl);
    expect((await PUT(appeler("PUT", "{}"))).status).toBe(400);
    expect((await PUT(appeler("PUT", "x".repeat(TAILLE_MAX_ETAT + 1)))).status).toBe(413);
    expect(
      (await PUT(appeler("PUT", "{}", { cookie, "content-length": String(TAILLE_MAX_ETAT + 1) }))).status,
    ).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("hub injoignable : 503, LIA garde son état local", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("réseau");
    }));
    expect((await GET(appeler("GET"))).status).toBe(503);
  });

  it("invité du hub : 403 rendu tel quel", async () => {
    vi.stubGlobal("fetch", hub(403, { error: "forbidden" }));
    expect((await GET(appeler("GET"))).status).toBe(403);
  });
});
