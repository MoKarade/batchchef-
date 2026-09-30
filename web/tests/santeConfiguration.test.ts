// GET /api/sante/configuration — contrôle PUBLIC de présence des variables (F7, prévention
// INC-16 : la production a répondu 503 parce qu'AUTH_SECRET/AUTHORIZED_EMAIL manquaient,
// et rien ne le disait). Deux niveaux : REQUISES (503) et DÉGRADANTES (200 + `degrade`).
//
// Règle absolue testée ici : aucune réponse HTTP (sonde ET middleware) ne nomme une
// variable, seulement des COMPTES. Les noms réels partent au journal serveur seulement.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VARIABLES_DEGRADANTES,
  VARIABLES_REQUISES,
  variablesManquantes,
} from "@/lib/configurationRequise";
import { GET } from "@/app/api/sante/configuration/route";
import { contourneAuthNonConfiguree, isPublicPath } from "@/lib/authGuard";
import { isAuthConfigured, variablesAuthManquantes } from "@/lib/authConfigured";

const TOUTES = [...VARIABLES_REQUISES, ...VARIABLES_DEGRADANTES] as const;

/** Valeurs de remplissage : seule la PRÉSENCE compte, jamais le contenu. */
function envComplet(): Record<string, string> {
  return Object.fromEntries(TOUTES.map((nom) => [nom, "present"]));
}

function envSans(...noms: string[]): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...envComplet() };
  for (const nom of noms) delete env[nom];
  return env;
}

/** Remplace process.env le temps d'un appel, et le restaure quoi qu'il arrive. */
async function avecEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const avant = process.env;
  process.env = { ...env } as NodeJS.ProcessEnv;
  try {
    return await fn();
  } finally {
    process.env = avant;
  }
}

/** Motif qui attrape n'importe quel nom de variable contrôlée dans un texte. */
const NOM_QUELCONQUE = new RegExp(TOUTES.join("|"), "i");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listes figées", () => {
  it("requises = ce dont l'absence bloque tout le monde (base, connexion)", () => {
    expect([...VARIABLES_REQUISES].sort()).toEqual(
      ["AUTHORIZED_EMAIL", "AUTH_SECRET", "DATABASE_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"].sort(),
    );
  });

  it("dégradantes = ce dont l'absence ne bloque que les invités", () => {
    expect([...VARIABLES_DEGRADANTES]).toEqual(["HUB_TOKEN"]);
  });
});

describe("variablesManquantes (fonction pure)", () => {
  it("toutes présentes : rien ne manque", () => {
    expect(variablesManquantes(envComplet())).toEqual({ requises: [], degradantes: [] });
  });

  it("environnement vide : tout manque, rangé par niveau", () => {
    expect(variablesManquantes({})).toEqual({
      requises: [...VARIABLES_REQUISES],
      degradantes: [...VARIABLES_DEGRADANTES],
    });
  });

  it.each(VARIABLES_REQUISES)("retirer %s seule : exactement cette requise manque", (nom) => {
    expect(variablesManquantes(envSans(nom))).toEqual({ requises: [nom], degradantes: [] });
  });

  it("retirer HUB_TOKEN seule : dégradante, pas requise", () => {
    expect(variablesManquantes(envSans("HUB_TOKEN"))).toEqual({ requises: [], degradantes: ["HUB_TOKEN"] });
  });

  it.each(["", "   ", "\t\n"])("une valeur vide ou blanche (%j) compte comme absente", (vide) => {
    expect(variablesManquantes({ ...envComplet(), AUTH_SECRET: vide }).requises).toEqual(["AUTH_SECRET"]);
    expect(variablesManquantes({ ...envComplet(), HUB_TOKEN: vide }).degradantes).toEqual(["HUB_TOKEN"]);
  });

  it("le compte des requises augmente d'un à chaque variable retirée", () => {
    const env: Record<string, string | undefined> = { ...envComplet() };
    VARIABLES_REQUISES.forEach((nom, i) => {
      delete env[nom];
      expect(variablesManquantes(env).requises).toHaveLength(i + 1);
    });
  });

  it("ne modifie pas l'environnement reçu", () => {
    const env = Object.freeze({ ...envComplet(), AUTH_SECRET: undefined });
    expect(() => variablesManquantes(env)).not.toThrow();
  });
});

describe("GET /api/sante/configuration", () => {
  it("toutes présentes : 200 { ok: true }, no-store, rien au journal", async () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await avecEnv(envComplet(), () => GET());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
    expect(journal).not.toHaveBeenCalled();
  });

  it.each(VARIABLES_REQUISES)("%s retirée : 503, compte 1, sans nom", async (nom) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await avecEnv(envSans(nom), () => GET());
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const corps = await res.text();
    expect(JSON.parse(corps)).toEqual({
      ok: false,
      cause: "configuration",
      manquantes: 1,
      message: "configuration incomplète : 1 variable manquante",
    });
    expect(corps).not.toMatch(NOM_QUELCONQUE);
  });

  it("HUB_TOKEN seule retirée : 200 { ok: true, degrade: 1 }, sans nom", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await avecEnv(envSans("HUB_TOKEN"), () => GET());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const corps = await res.text();
    expect(JSON.parse(corps)).toEqual({ ok: true, degrade: 1 });
    expect(corps).not.toMatch(NOM_QUELCONQUE);
  });

  it("tout absent : 503, compte des requises seulement, dégradation comptée à part", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await avecEnv({}, () => GET());
    const n = VARIABLES_REQUISES.length;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      ok: false,
      cause: "configuration",
      manquantes: n,
      degrade: 1,
      message: `configuration incomplète : ${n} variables manquantes`,
    });
  });

  it("adversarial : aucune combinaison de manques ne fait fuiter un nom ni une valeur", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const n = TOUTES.length;
    // Toutes les combinaisons (2^6 = 64) : aucune ne doit laisser passer un nom.
    for (let masque = 0; masque < 2 ** n; masque++) {
      const env: Record<string, string | undefined> = {};
      TOUTES.forEach((nom, i) => {
        // Valeur piégée : si elle ressortait, le test la verrait.
        if (masque & (1 << i)) env[nom] = `valeur-piege-${nom}`;
      });
      const res = await avecEnv(env, () => GET());
      const corps = await res.text();
      expect(corps).not.toMatch(NOM_QUELCONQUE);
      expect(corps).not.toMatch(/valeur-piege/);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("le journal serveur reçoit les NOMS réels manquants, jamais une valeur", async () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = { ...envSans("AUTH_SECRET", "AUTHORIZED_EMAIL", "HUB_TOKEN"), DATABASE_URL: "valeur-piege" };
    await avecEnv(env, () => GET());
    expect(journal).toHaveBeenCalledTimes(1);
    const ecrit = journal.mock.calls.flat().join(" ");
    expect(ecrit).toMatch(/AUTH_SECRET/);
    expect(ecrit).toMatch(/AUTHORIZED_EMAIL/);
    expect(ecrit).toMatch(/HUB_TOKEN/);
    expect(ecrit).not.toMatch(/DATABASE_URL|GOOGLE_CLIENT|valeur-piege|present/);
  });
});

describe("variablesAuthManquantes / isAuthConfigured", () => {
  it("liste les variables d'auth absentes ou blanches, dans l'ordre", () => {
    expect(variablesAuthManquantes({})).toEqual(["AUTH_SECRET", "AUTHORIZED_EMAIL"]);
    expect(variablesAuthManquantes({ AUTH_SECRET: "s", AUTHORIZED_EMAIL: " " })).toEqual(["AUTHORIZED_EMAIL"]);
    expect(variablesAuthManquantes({ AUTH_SECRET: "s", AUTHORIZED_EMAIL: "a@b.c" })).toEqual([]);
    expect(isAuthConfigured({ AUTH_SECRET: "s", AUTHORIZED_EMAIL: "a@b.c" })).toBe(true);
    expect(isAuthConfigured({ AUTHORIZED_EMAIL: "a@b.c" })).toBe(false);
  });
});

describe("garde : la sonde reste joignable quand l'authentification n'est pas configurée", () => {
  it("publique par ÉGALITÉ STRICTE", () => {
    expect(isPublicPath("/api/sante/configuration")).toBe(true);
    expect(isPublicPath("/api/sante/configuration/x")).toBe(false);
    expect(isPublicPath("/api/sante/configuration-x")).toBe(false);
    expect(isPublicPath("/api/sante/autre")).toBe(false);
  });

  it("le VRAI middleware, auth non configurée : 503 générique partout sauf sur la sonde", async () => {
    // `auth()` d'Auth.js remplacé par l'identité : on teste la logique du middleware, pas
    // Auth.js. Sans cette exception, INC-16 rendrait la sonde muette.
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    vi.doMock("@/auth", () => ({ auth: (fn: unknown) => fn }));
    try {
      const { default: middleware } = await import("@/middleware");
      const appeler = (chemin: string) => {
        const req = { auth: null, nextUrl: new URL(chemin, "https://batchchef.test") };
        return (middleware as unknown as (r: typeof req) => Response | undefined)(req);
      };
      const reponses = await avecEnv({ DATABASE_URL: "present" }, async () => ({
        sonde: appeler("/api/sante/configuration"),
        bloquees: [appeler("/"), appeler("/api/sante"), appeler("/api/sante/configuration-x")],
      }));
      expect(reponses.sonde).toBeUndefined(); // laissée passer jusqu'à la route
      for (const r of reponses.bloquees) {
        expect(r?.status).toBe(503);
        // Message générique : aucun nom de variable dans la réponse publique.
        const corps = await r!.text();
        expect(JSON.parse(corps)).toEqual({
          error: "auth_unconfigured",
          message: "Authentification non configurée. Accès refusé.",
        });
        expect(corps).not.toMatch(NOM_QUELCONQUE);
      }
      // Les noms, eux, sont au journal serveur.
      const ecrit = journal.mock.calls.flat().join(" ");
      expect(ecrit).toMatch(/AUTH_SECRET/);
      expect(ecrit).toMatch(/AUTHORIZED_EMAIL/);
    } finally {
      vi.doUnmock("@/auth");
      vi.resetModules();
    }
  });

  it("seule elle contourne le 503 « auth non configurée » du middleware", () => {
    expect(contourneAuthNonConfiguree("/api/sante/configuration")).toBe(true);
    for (const chemin of [
      "/",
      "/api/sante",
      "/api/sante/configuration/x",
      "/api/sante/configuration-x",
      "/api/hub/summary",
      "/api/mcp",
      "/login",
      "/recettes",
    ]) {
      expect(contourneAuthNonConfiguree(chemin)).toBe(false);
    }
  });
});
