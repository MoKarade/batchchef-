// tests/lia.hubCookie.test.ts — le cookie de session ne se perd pas dans la redirection hubperso.com → www.hubperso.com
// (undici retire `cookie` quand une redirection change d'origine ; constaté en production le 24/10/2026 : 401 sur /api/lia/etat).

import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHubAvecCookie, memeSiteAuWwwPres } from "../lib/lia/hubCookie";
import { relayerEtatHub } from "../lib/lia/etatHub";
import { lirePauseHub } from "../lib/lia/pauseHub";

const cookie = "__Secure-authjs.session-token=abc";
const redirige = (statut: number, vers: string) => new Response(null, { status: statut, headers: { location: vers } });

describe("memeSiteAuWwwPres", () => {
  it("apex ↔ www, rien d'autre", () => {
    const u = (s: string) => new URL(s);
    expect(memeSiteAuWwwPres(u("https://hubperso.com/a"), u("https://www.hubperso.com/a"))).toBe(true);
    expect(memeSiteAuWwwPres(u("https://www.hubperso.com/a"), u("https://hubperso.com/a"))).toBe(true);
    expect(memeSiteAuWwwPres(u("https://hubperso.com/a"), u("https://autre.hubperso.com/a"))).toBe(false);
    expect(memeSiteAuWwwPres(u("https://hubperso.com/a"), u("https://hubperso.com.evil.test/a"))).toBe(false);
    expect(memeSiteAuWwwPres(u("https://hubperso.com/a"), u("http://www.hubperso.com/a"))).toBe(false);
    expect(memeSiteAuWwwPres(u("https://hubperso.com/a"), u("https://www.hubperso.com:8443/a"))).toBe(false);
  });
});

describe("fetchHubAvecCookie", () => {
  it("308 apex → www : suit UNE fois, avec le cookie, la méthode et le corps", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirige(308, "https://www.hubperso.com/api/lia/etat"))
      .mockResolvedValueOnce(Response.json({ ok: 1 }));
    const init = { method: "PUT", headers: { cookie }, body: "{}" };
    const res = await fetchHubAvecCookie("https://hubperso.com/api/lia/etat", init, fetchImpl);
    expect(await res.json()).toEqual({ ok: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url2, init2] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(url2).toBe("https://www.hubperso.com/api/lia/etat");
    expect(init2).toMatchObject({ method: "PUT", headers: { cookie }, body: "{}", redirect: "manual" });
  });

  it("jamais de redirection vers un autre site, en http, sans Location, ni en 301/302 : le 3xx est rendu tel quel", async () => {
    for (const [statut, vers] of [
      [308, "https://evil.test/api/lia/etat"],
      [308, "http://www.hubperso.com/api/lia/etat"],
      [308, "https://hubperso.com.evil.test/x"],
      [302, "https://www.hubperso.com/api/lia/etat"],
    ] as const) {
      const fetchImpl = vi.fn().mockResolvedValue(redirige(statut, vers));
      const res = await fetchHubAvecCookie("https://hubperso.com/api/lia/etat", { headers: { cookie } }, fetchImpl);
      expect(res.status).toBe(statut);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
    const sansLocation = vi.fn().mockResolvedValue(new Response(null, { status: 308 }));
    expect((await fetchHubAvecCookie("https://hubperso.com/x", {}, sansLocation)).status).toBe(308);
  });

  it("une seule redirection suivie : une boucle s'arrête au second 308", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(redirige(308, "https://www.hubperso.com/x"));
    const res = await fetchHubAvecCookie("https://hubperso.com/x", {}, fetchImpl);
    expect(res.status).toBe(308);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("pas de redirection : une seule requête", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ pause: false }));
    await fetchHubAvecCookie("https://www.hubperso.com/x", {}, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("le relais d'état et de pause passent la redirection avec le cookie", () => {
  it("relayerEtatHub : 401 de l'apex sans cookie ne se produit plus (le cookie arrive au www)", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const hote = new URL(String(url)).hostname;
      if (hote === "hubperso.com") return redirige(308, "https://www.hubperso.com/api/lia/etat");
      const c = (init?.headers as Record<string, string> | undefined)?.cookie;
      return c ? new Response(null, { status: 204 }) : Response.json({ error: "unauthorized" }, { status: 401 });
    });
    await expect(relayerEtatHub("GET", cookie, { fetchImpl: fetchImpl as never, env: {} })).resolves.toEqual({
      status: 204,
      corps: null,
    });
  });

  it("lirePauseHub : idem", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (new URL(String(url)).hostname === "hubperso.com") return redirige(308, "https://www.hubperso.com/api/lia/pause");
      const c = (init?.headers as Record<string, string> | undefined)?.cookie;
      return c ? Response.json({ pause: false }) : Response.json({}, { status: 401 });
    });
    await expect(lirePauseHub(cookie, { fetchImpl: fetchImpl as never, env: {} })).resolves.toBe(false);
  });
});

// Le piège réel, sans mock : avec `redirect: "follow"` (le défaut), Node retire `cookie` d'une redirection entre deux origines.
describe("le comportement de Node qui motive ce module", () => {
  const serveurs: Server[] = [];
  afterEach(() => serveurs.splice(0).forEach((s) => s.close()));

  it("fetch par défaut perd le cookie à la redirection entre origines ; fetchHubAvecCookie le garde", async () => {
    const cible = createServer((q, r) => r.end(JSON.stringify({ cookie: q.headers.cookie ?? null }))).listen(0);
    const portCible = (cible.address() as { port: number }).port;
    const source = createServer((_q, r) => {
      r.writeHead(308, { location: `http://localhost:${portCible}/x` });
      r.end();
    }).listen(0);
    serveurs.push(cible, source);
    const portSource = (source.address() as { port: number }).port;
    const init = { headers: { cookie: "s=1" } };
    const naif = await fetch(`http://127.0.0.1:${portSource}/y`, init);
    expect(await naif.json()).toEqual({ cookie: null });
  });
});
