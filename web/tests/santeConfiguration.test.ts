// GET /api/sante/configuration — contrôle PUBLIC de présence des variables requises (F7,
// prévention INC-16 : la production a répondu 503 parce qu'AUTH_SECRET/AUTHORIZED_EMAIL
// manquaient, et rien ne le disait).
//
// Règle absolue testée ici : la réponse HTTP ne nomme JAMAIS une variable, elle ne donne
// qu'un COMPTE. Les noms réels partent au journal serveur (console.error) seulement.

import { afterEach, describe, expect, it, vi } from "vitest";
import { VARIABLES_REQUISES, variablesManquantes } from "@/lib/configurationRequise";
import { GET } from "@/app/api/sante/configuration/route";
import { contourneAuthNonConfiguree, isPublicPath } from "@/lib/authGuard";

/** Valeurs de remplissage : seule la PRÉSENCE compte, jamais le contenu. */
function envComplet(): Record<string, string> {
  return Object.fromEntries(VARIABLES_REQUISES.map((nom) => [nom, "present"]));
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

/** Motif qui attrape n'importe quel nom de variable requise dans un texte. */
const NOM_QUELCONQUE = new RegExp(VARIABLES_REQUISES.join("|"), "i");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("liste figée des variables requises", () => {
  it("contient exactement les variables dont l'absence casse connexion, base ou accès", () => {
    expect([...VARIABLES_REQUISES].sort()).toEqual(
      [
        "AUTHORIZED_EMAIL",
        "AUTH_SECRET",
        "DATABASE_URL",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "HUB_TOKEN",
      ].sort(),
    );
  });
});

describe("variablesManquantes (fonction pure)", () => {
  it("toutes présentes : aucune manquante", () => {
    expect(variablesManquantes(envComplet())).toEqual([]);
  });

  it("environnement vide : toutes manquantes", () => {
    expect(variablesManquantes({})).toEqual([...VARIABLES_REQUISES]);
  });

  it.each(VARIABLES_REQUISES)("retirer %s seule : exactement cette variable manque", (nom) => {
    const env: Record<string, string | undefined> = { ...envComplet() };
    delete env[nom];
    expect(variablesManquantes(env)).toEqual([nom]);
  });

  it.each(["", "   ", "\t\n"])("une valeur vide ou blanche (%j) compte comme absente", (vide) => {
    expect(variablesManquantes({ ...envComplet(), AUTH_SECRET: vide })).toEqual(["AUTH_SECRET"]);
  });

  it("le compte augmente d'un à chaque variable retirée", () => {
    const env: Record<string, string | undefined> = { ...envComplet() };
    VARIABLES_REQUISES.forEach((nom, i) => {
      delete env[nom];
      expect(variablesManquantes(env)).toHaveLength(i + 1);
    });
  });

  it("ne modifie pas l'environnement reçu", () => {
    const env = Object.freeze({ ...envComplet(), AUTH_SECRET: undefined });
    expect(() => variablesManquantes(env)).not.toThrow();
  });
});

describe("GET /api/sante/configuration", () => {
  it("toutes présentes : 200 { ok: true }, no-store", async () => {
    const res = await avecEnv(envComplet(), () => GET());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
  });

  it.each(VARIABLES_REQUISES)("%s retirée : 503, compte 1, sans nom", async (nom) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env: Record<string, string | undefined> = { ...envComplet() };
    delete env[nom];
    const res = await avecEnv(env, () => GET());
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

  it("toutes absentes : compte = nombre de variables requises", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await avecEnv({}, () => GET());
    const n = VARIABLES_REQUISES.length;
    expect(await res.json()).toEqual({
      ok: false,
      cause: "configuration",
      manquantes: n,
      message: `configuration incomplète : ${n} variables manquantes`,
    });
  });

  it("adversarial : aucune combinaison de manques ne fait fuiter un nom ni une valeur", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const n = VARIABLES_REQUISES.length;
    // Toutes les combinaisons (2^6 = 64) : aucune ne doit laisser passer un nom.
    for (let masque = 0; masque < 2 ** n; masque++) {
      const env: Record<string, string | undefined> = {};
      VARIABLES_REQUISES.forEach((nom, i) => {
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
    const env: Record<string, string | undefined> = { ...envComplet(), HUB_TOKEN: "valeur-piege" };
    delete env.AUTH_SECRET;
    delete env.AUTHORIZED_EMAIL;
    await avecEnv(env, () => GET());
    expect(journal).toHaveBeenCalledTimes(1);
    const ecrit = journal.mock.calls.flat().join(" ");
    expect(ecrit).toMatch(/AUTH_SECRET/);
    expect(ecrit).toMatch(/AUTHORIZED_EMAIL/);
    expect(ecrit).not.toMatch(/DATABASE_URL|HUB_TOKEN|valeur-piege|present/);
  });

  it("configuration complète : rien au journal", async () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    await avecEnv(envComplet(), () => GET());
    expect(journal).not.toHaveBeenCalled();
  });
});

describe("garde : la sonde reste joignable quand l'authentification n'est pas configurée", () => {
  it("publique par ÉGALITÉ STRICTE", () => {
    expect(isPublicPath("/api/sante/configuration")).toBe(true);
    expect(isPublicPath("/api/sante/configuration/x")).toBe(false);
    expect(isPublicPath("/api/sante/configuration-x")).toBe(false);
    expect(isPublicPath("/api/sante/autre")).toBe(false);
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
