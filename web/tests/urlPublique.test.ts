// Garde SSRF de l'import par URL : aucune requête réseau réelle (résolveur et transport injectés).

import { describe, expect, it, vi } from "vitest";
import {
  MAX_OCTETS_PAGE,
  MAX_REDIRECTIONS,
  UrlRefusee,
  ipNonPublique,
  lookupPublic,
  telechargerPagePublique,
  verifierUrlPublique,
  type ReponseBrute,
  type Transport,
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
    "::ffff:93.184.216.34", // mappée : refusée aussi (liste blanche)
    "::7f00:1", // IPv4-compatible
    "::127.0.0.1",
    "64:ff9b::7f00:1", // NAT64
    "64:ff9b::a00:1",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2", // Teredo
    "2002:7f00:1::1", // 6to4
    "2001:db8::1", // documentation
    "2001:0db8:0:0:0:0:0:1",
    "n'importe quoi",
  ])("refuse %s", (ip) => {
    expect(ipNonPublique(ip)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111", "2a00:1450:4007:80f::200e"])(
    "accepte %s",
    (ip) => {
      expect(ipNonPublique(ip)).toBe(false);
    },
  );
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
    "http://[::7f00:1]/",
    "http://169.254.169.254/latest/meta-data/",
    // Formes numériques : `new URL()` les normalise en 127.0.0.1 / 0.0.0.0, puis refus.
    "http://2130706433/", // décimal
    "http://0x7f.1/", // hexadécimal
    "http://017700000001/", // octal
    "http://127.1/", // abrégé
    "http://0/",
    "https://user:mdp@exemple.com/",
    "https://exemple.com:22/",
    "http://exemple.com:6379/",
    "https://exemple.com:8443/",
  ])("refuse %s", async (url) => {
    await expect(verifierUrlPublique(url, publique)).rejects.toBeInstanceOf(UrlRefusee);
  });

  it("les formes numériques sont bien normalisées par URL (comportement figé)", () => {
    expect(new URL("http://2130706433/").hostname).toBe("127.0.0.1");
    expect(new URL("http://0x7f.1/").hostname).toBe("127.0.0.1");
    expect(new URL("http://017700000001/").hostname).toBe("127.0.0.1");
    expect(new URL("http://127.1/").hostname).toBe("127.0.0.1");
    expect(new URL("http://0/").hostname).toBe("0.0.0.0");
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

  it("accepte une URL publique, ports 80 et 443 compris", async () => {
    expect((await verifierUrlPublique("https://exemple.com/recette?a=1", publique)).hostname).toBe("exemple.com");
    await expect(verifierUrlPublique("http://exemple.com:80/", publique)).resolves.toBeInstanceOf(URL);
    await expect(verifierUrlPublique("https://exemple.com:443/", publique)).resolves.toBeInstanceOf(URL);
  });
});

describe("lookupPublic (vérification AU MOMENT DE LA CONNEXION)", () => {
  const appeler = (resoudre: () => Promise<string[]>, all = false) =>
    new Promise<{ err: unknown; adresse: unknown; famille?: number }>((res) => {
      lookupPublic(resoudre)("exemple.com", { all }, (err, adresse, famille) => res({ err, adresse, famille }));
    });

  it("rend l'adresse validée, exactement", async () => {
    const r = await appeler(async () => ["93.184.216.34"]);
    expect(r).toMatchObject({ err: null, adresse: "93.184.216.34", famille: 4 });
    const tous = await appeler(async () => ["93.184.216.34"], true);
    expect(tous.adresse).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("refuse une adresse non publique, même partielle", async () => {
    expect((await appeler(async () => ["127.0.0.1"])).err).toBeInstanceOf(UrlRefusee);
    expect((await appeler(async () => ["93.184.216.34", "::1"])).err).toBeInstanceOf(UrlRefusee);
    expect((await appeler(async () => [])).err).toBeInstanceOf(UrlRefusee);
  });

  it("propage une panne du résolveur", async () => {
    const r = await appeler(async () => {
      throw new Error("ENOTFOUND");
    });
    expect((r.err as Error).message).toBe("ENOTFOUND");
  });
});

function brute(status: number, corps: string | Uint8Array = "", location: string | null = null): ReponseBrute {
  const octets = typeof corps === "string" ? new TextEncoder().encode(corps) : corps;
  return {
    status,
    location,
    corps: (async function* () {
      // Par morceaux : la borne doit couper au milieu de la réponse.
      for (let i = 0; i < octets.length; i += 65536) yield octets.subarray(i, i + 65536);
    })(),
    fermer: () => undefined,
  };
}

const transportDe = (...reponses: ReponseBrute[]) => {
  const suite = [...reponses];
  return vi.fn<Transport>(async () => suite.shift() ?? brute(200, "fin"));
};

describe("telechargerPagePublique", () => {
  it("rend le texte d'une page publique", async () => {
    const transport = transportDe(brute(200, "<p>bonjour</p>"));
    const r = await telechargerPagePublique("https://exemple.com/", { transport, resoudre: publique });
    expect(r).toEqual({ ok: true, status: 200, texte: "<p>bonjour</p>" });
  });

  it("refuse une redirection vers 169.254.169.254, sans s'y connecter", async () => {
    const transport = transportDe(brute(302, "", "http://169.254.169.254/latest/meta-data/"));
    await expect(
      telechargerPagePublique("https://exemple.com/", { transport, resoudre: publique }),
    ).rejects.toBeInstanceOf(UrlRefusee);
    expect(transport).toHaveBeenCalledOnce();
  });

  it("refuse une redirection vers un hôte qui RÉSOUT en privé", async () => {
    const resoudre = async (h: string) => (h === "interne.exemple.com" ? ["10.0.0.9"] : ["93.184.216.34"]);
    const transport = transportDe(brute(302, "", "https://interne.exemple.com/x"));
    await expect(telechargerPagePublique("https://exemple.com/", { transport, resoudre })).rejects.toThrow(/privée/);
    expect(transport).toHaveBeenCalledOnce();
  });

  it("refuse une redirection vers un port interne", async () => {
    const transport = transportDe(brute(302, "", "https://exemple.com:6379/"));
    await expect(
      telechargerPagePublique("https://exemple.com/", { transport, resoudre: publique }),
    ).rejects.toThrow(/Port/);
  });

  it("refuse le passage https → http à une redirection, accepte http → https", async () => {
    const bas = transportDe(brute(301, "", "http://exemple.com/a"));
    await expect(
      telechargerPagePublique("https://exemple.com/", { transport: bas, resoudre: publique }),
    ).rejects.toThrow(/https vers http/);
    const haut = transportDe(brute(301, "", "https://exemple.com/a"), brute(200, "ok"));
    const r = await telechargerPagePublique("http://exemple.com/", { transport: haut, resoudre: publique });
    expect(r.texte).toBe("ok");
  });

  it("suit une redirection relative vers une page publique", async () => {
    const transport = transportDe(brute(301, "", "/ailleurs"), brute(200, "fin"));
    const r = await telechargerPagePublique("https://exemple.com/a", { transport, resoudre: publique });
    expect(r.texte).toBe("fin");
    expect(transport.mock.calls[1]![0].toString()).toBe("https://exemple.com/ailleurs");
  });

  it("s'arrête après trop de redirections", async () => {
    const transport = vi.fn<Transport>(async () => brute(302, "", "https://exemple.com/boucle"));
    await expect(
      telechargerPagePublique("https://exemple.com/", { transport, resoudre: publique }),
    ).rejects.toThrow(/redirections/);
    expect(transport).toHaveBeenCalledTimes(MAX_REDIRECTIONS + 1);
  });

  it("une redirection sans destination est refusée", async () => {
    const transport = transportDe(brute(302));
    await expect(
      telechargerPagePublique("https://exemple.com/", { transport, resoudre: publique }),
    ).rejects.toThrow(/sans destination/);
  });

  it("rend ok:false avec le code HTTP quand la page échoue", async () => {
    const transport = transportDe(brute(404));
    const r = await telechargerPagePublique("https://exemple.com/", { transport, resoudre: publique });
    expect(r).toEqual({ ok: false, status: 404, texte: "" });
  });

  it("borne le corps lu à 2 Mo", async () => {
    const transport = transportDe(brute(200, "a".repeat(MAX_OCTETS_PAGE + 5000)));
    const r = await telechargerPagePublique("https://exemple.com/", { transport, resoudre: publique });
    expect(r.texte.length).toBe(MAX_OCTETS_PAGE);
  });

  it("DNS REBINDING : nom public à la validation, privé à la connexion → refus", async () => {
    let appels = 0;
    // 1re résolution (validation) : publique ; suivantes (connexion) : boucle locale.
    const resoudre = async () => (++appels === 1 ? ["93.184.216.34"] : ["127.0.0.1"]);
    // Transport qui, comme une vraie socket, se connecte via le `lookup` fourni.
    const transport: Transport = (url, opts) =>
      new Promise((res, rej) => {
        opts.lookup(url.hostname, {}, (err) => (err ? rej(err) : res(brute(200, "SECRET"))));
      });
    await expect(telechargerPagePublique("https://rebind.exemple.com/", { transport, resoudre })).rejects.toBeInstanceOf(
      UrlRefusee,
    );
    expect(appels).toBe(2);
  });

  it("le lookup de connexion accepte une adresse restée publique", async () => {
    const transport: Transport = (url, opts) =>
      new Promise((res, rej) => {
        opts.lookup(url.hostname, {}, (err, adresse) =>
          err ? rej(err) : res(brute(200, `via ${String(adresse)}`)),
        );
      });
    const r = await telechargerPagePublique("https://exemple.com/", { transport, resoudre: publique });
    expect(r.texte).toBe("via 93.184.216.34");
  });
});
