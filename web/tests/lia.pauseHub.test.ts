// tests/lia.pauseHub.test.ts — la pause générale lue chez le hub, puis relayée par GET /api/lia/pause. Échec fermé partout.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSession, NonAutorise } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  NonAutorise: class NonAutorise extends Error {},
}));
vi.mock("@/lib/lia/session", () => ({ requireSession, NonAutorise }));

import { GET } from "../app/api/lia/pause/route";
import { lirePauseHub } from "../lib/lia/pauseHub";

const env = {};
const cookie = "authjs.session-token=abc";
const hub = (statut: number, corps: unknown) => vi.fn(async () => Response.json(corps, { status: statut }));

describe("lirePauseHub", () => {
  it("lit la pause du hub avec le cookie de session de l'utilisateur, en https, sans cache", async () => {
    const fetchImpl = hub(200, { pause: true, modifieLe: null });
    await expect(lirePauseHub(cookie, { fetchImpl, env })).resolves.toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hubperso.com/api/lia/pause");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ cookie });
    expect(init.cache).toBe("no-store");
  });

  it("pas de cookie : illisible, et aucun appel réseau", async () => {
    const fetchImpl = hub(200, { pause: false });
    await expect(lirePauseHub(null, { fetchImpl, env })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("401, 403 (invité), 503, corps illisible, réseau en panne : illisible, jamais « pas en pause »", async () => {
    for (const statut of [401, 403, 503]) {
      await expect(lirePauseHub(cookie, { fetchImpl: hub(statut, { pause: false }), env })).resolves.toBeNull();
    }
    await expect(
      lirePauseHub(cookie, { fetchImpl: vi.fn(async () => new Response("pas du json")), env }),
    ).resolves.toBeNull();
    await expect(
      lirePauseHub(cookie, { fetchImpl: vi.fn(async () => Promise.reject(new Error("réseau"))), env }),
    ).resolves.toBeNull();
  });

  it("adresse du hub douteuse ou en http : illisible, le cookie ne part pas", async () => {
    const fetchImpl = hub(200, { pause: false });
    await expect(lirePauseHub(cookie, { fetchImpl, env: { NEXT_PUBLIC_HUB_URL: "http://hubperso.com" } })).resolves.toBeNull();
    await expect(lirePauseHub(cookie, { fetchImpl, env: { NEXT_PUBLIC_HUB_URL: "pas une url" } })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("GET /api/lia/pause", () => {
  beforeEach(() => {
    requireSession.mockReset().mockResolvedValue({ email: "marc@exemple.test" });
    vi.unstubAllGlobals();
  });
  const requete = () =>
    new Request("https://app.test/api/lia/pause", { headers: { cookie } });

  it("sans session : 401, et le hub n'est PAS appelé", async () => {
    requireSession.mockRejectedValue(new NonAutorise());
    const fetchImpl = hub(200, { pause: false });
    vi.stubGlobal("fetch", fetchImpl);
    const res = await GET(requete());
    expect(res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("une autre erreur que « non autorisé » n'est pas avalée", async () => {
    requireSession.mockRejectedValue(new Error("panne inattendue"));
    await expect(GET(requete())).rejects.toThrow("panne inattendue");
  });

  it("le hub dit pause : 200 { pause: true }, no-store", async () => {
    vi.stubGlobal("fetch", hub(200, { pause: true, modifieLe: "2026-10-24T12:00:00Z" }));
    const res = await GET(requete());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ pause: true });
  });

  it("le hub dit pas de pause : 200 { pause: false }", async () => {
    vi.stubGlobal("fetch", hub(200, { pause: false, modifieLe: null }));
    expect(await (await GET(requete())).json()).toEqual({ pause: false });
  });

  it("le hub refuse ou ne répond pas : 503, jamais « pas en pause »", async () => {
    vi.stubGlobal("fetch", hub(403, { error: "forbidden" }));
    const res = await GET(requete());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "pause_illisible" });
  });
});
