// Garde SSRF de l'import par URL : aucune requête réseau réelle (résolveur et fetch injectés).

import { describe, expect, it, vi } from "vitest";
import {
  MAX_OCTETS_PAGE,
  MAX_REDIRECTIONS,
  UrlRefusee,
  ipNonPublique,
  telechargerPagePublique,
  verifierUrlPublique,
} from "../lib/urlPublique";

const publique = async () => ["93.184.216.34"];

describe("ipNonPublique", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "n'importe quoi",
  ])("refuse %s", (ip) => {
    expect(ipNonPublique(ip)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111"])("accepte %s", (ip) => {
    expect(ipNonPublique(ip)).toBe(false);
  });
});

describe("verifierUrlPublique", () => {
  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "ftp://exemple.com/a",
    "pas une url",
    "http://localhost/",
    "http://api.localhost/",
    "http://machine.internal/",
    "http://imprimante.local/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://2130706433/", // 127.0.0.1 en décimal : normalisé par URL, doit être refusé
    "https://user:mdp@exemple.com/",
  ])("refuse %s", async (url) => {
    await expect(verifierUrlPublique(url, publique)).rejects.toBeInstanceOf(UrlRefusee);
  });

  it("refuse un nom public qui RÉSOUT vers une adresse privée", async () => {
    await expect(verifierUrlPublique("https://piege.exemple.com/", async () => ["10.0.0.5"])).rejects.toThrow(
      /privée/,
    );
  });

  it("refuse dès qu'UNE des adresses résolues est privée", async () => {
    await expect(
      verifierUrlPublique("https://mixte.exemple.com/", async () => ["93.184.216.34", "127.0.0.1"]),
    ).rejects.toBeInstanceOf(UrlRefusee);
  });

  it("refuse un hôte introuvable", async () => {
    await expect(
      verifierUrlPublique("https://inconnu.exemple.com/", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).rejects.toThrow(/introuvable/);
  });

  it("accepte une URL publique", async () => {
    const u = await verifierUrlPublique("https://exemple.com/recette?a=1", publique);
    expect(u.hostname).toBe("exemple.com");
  });
});

function reponse(status: number, corps = "", entetes: Record<string, string> = {}): Response {
  return new Response(corps, { status, headers: entetes });
}

describe("telechargerPagePublique", () => {
  it("rend le texte d'une page publique", async () => {
    const fetcher = vi.fn(async () => reponse(200, "<p>bonjour</p>"));
    const r = await telechargerPagePublique("https://exemple.com/", {
      fetcher: fetcher as unknown as typeof fetch,
      resoudre: publique,
    });
    expect(r).toEqual({ ok: true, status: 200, texte: "<p>bonjour</p>" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("ne suit JAMAIS une redirection automatiquement (redirect: manual)", async () => {
    const fetcher = vi.fn(async () => reponse(200, "x"));
    await telechargerPagePublique("https://exemple.com/", {
      fetcher: fetcher as unknown as typeof fetch,
      resoudre: publique,
    });
    const init = (fetcher.mock.calls[0] as unknown as [unknown, RequestInit])[1];
    expect(init.redirect).toBe("manual");
  });

  it("refuse une redirection vers une adresse interne, sans la télécharger", async () => {
    const fetcher = vi.fn(async () =>
      reponse(302, "", { location: "http://169.254.169.254/latest/meta-data/" }),
    );
    await expect(
      telechargerPagePublique("https://exemple.com/", {
        fetcher: fetcher as unknown as typeof fetch,
        resoudre: publique,
      }),
    ).rejects.toBeInstanceOf(UrlRefusee);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("suit une redirection relative vers une page publique", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reponse(301, "", { location: "/ailleurs" }))
      .mockResolvedValueOnce(reponse(200, "fin"));
    const r = await telechargerPagePublique("https://exemple.com/a", {
      fetcher: fetcher as unknown as typeof fetch,
      resoudre: publique,
    });
    expect(r.texte).toBe("fin");
    expect((fetcher.mock.calls[1] as unknown as [URL])[0].toString()).toBe("https://exemple.com/ailleurs");
  });

  it("s'arrête après trop de redirections", async () => {
    const fetcher = vi.fn(async () => reponse(302, "", { location: "https://exemple.com/boucle" }));
    await expect(
      telechargerPagePublique("https://exemple.com/", {
        fetcher: fetcher as unknown as typeof fetch,
        resoudre: publique,
      }),
    ).rejects.toThrow(/redirections/);
    expect(fetcher).toHaveBeenCalledTimes(MAX_REDIRECTIONS + 1);
  });

  it("une redirection sans destination est refusée", async () => {
    const fetcher = vi.fn(async () => reponse(302));
    await expect(
      telechargerPagePublique("https://exemple.com/", {
        fetcher: fetcher as unknown as typeof fetch,
        resoudre: publique,
      }),
    ).rejects.toThrow(/sans destination/);
  });

  it("rend ok:false avec le code HTTP quand la page échoue", async () => {
    const fetcher = vi.fn(async () => reponse(404));
    const r = await telechargerPagePublique("https://exemple.com/", {
      fetcher: fetcher as unknown as typeof fetch,
      resoudre: publique,
    });
    expect(r).toEqual({ ok: false, status: 404, texte: "" });
  });

  it("borne le corps lu", async () => {
    const gros = "a".repeat(MAX_OCTETS_PAGE + 5000);
    const fetcher = vi.fn(async () => reponse(200, gros));
    const r = await telechargerPagePublique("https://exemple.com/", {
      fetcher: fetcher as unknown as typeof fetch,
      resoudre: publique,
    });
    expect(r.texte.length).toBe(MAX_OCTETS_PAGE);
  });
});
