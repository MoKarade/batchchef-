// GET /api/sante — sonde de santé publique pour la vigie de l'Atelier (modèle CarAI #204).
//
// Trois cas, sur les VRAIS modules :
//   - `DATABASE_URL` absent : le VRAI `lib/db` (connexion paresseuse) lève à la première
//     requête → 503, sans laisser fuiter le message ;
//   - base joignable : Postgres en mémoire (PGlite) à la place de Neon → 200 ;
//   - base qui refuse la requête → 503, message brut seulement dans le journal serveur.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NO_STORE = "no-store";

async function sansDatabaseUrl<T>(fn: () => Promise<T>): Promise<T> {
  const avant = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    return await fn();
  } finally {
    if (avant !== undefined) process.env.DATABASE_URL = avant;
  }
}

beforeEach(() => {
  // Les cas ci-dessous ne parlent pas du commit : la variable ne doit pas venir de la machine.
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/db");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("GET /api/sante — base non configurée (vrai lib/db)", () => {
  it("503 { ok: false, cause: \"base\" }, no-store, sans message brut", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/sante/route");
    const res = await sansDatabaseUrl(() => GET());
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe(NO_STORE);
    const corps = await res.text();
    expect(JSON.parse(corps)).toEqual({ ok: false, cause: "base" });
    expect(corps).not.toMatch(/DATABASE_URL|neon|postgres|manquant/i);
  });
});

describe("GET /api/sante — base réelle en mémoire (PGlite)", () => {
  it("200 { ok: true }, no-store", async () => {
    vi.doMock("@/lib/db", async () => {
      const { PGlite } = await import("@electric-sql/pglite");
      const { drizzle } = await import("drizzle-orm/pglite");
      return { db: drizzle(new PGlite()) };
    });
    const { GET } = await import("@/app/api/sante/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(NO_STORE);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("une base qui refuse : 503, le détail part au journal serveur, jamais dans la réponse", async () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("@/lib/db", () => ({
      db: {
        execute: async () => {
          throw new Error("quota dépassé sur ep-secret-123.neon.tech");
        },
      },
    }));
    const { GET } = await import("@/app/api/sante/route");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe(NO_STORE);
    const corps = await res.text();
    expect(JSON.parse(corps)).toEqual({ ok: false, cause: "base" });
    expect(corps).not.toMatch(/quota|neon|secret/i);
    expect(journal).toHaveBeenCalled();
  });
});

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("GET /api/sante — commit servi", () => {
  const baseOk = () =>
    vi.doMock("@/lib/db", () => ({ db: { execute: async () => [] } }));
  const baseKo = () =>
    vi.doMock("@/lib/db", () => ({
      db: {
        execute: async () => {
          throw new Error("hors service");
        },
      },
    }));

  it("variable posée : les 7 premiers caractères, base ok", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", SHA);
    baseOk();
    const { GET } = await import("@/app/api/sante/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, commit: "0123456" });
  });

  it("variable posée : le commit est aussi rendu quand la base refuse", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", SHA);
    vi.spyOn(console, "error").mockImplementation(() => {});
    baseKo();
    const { GET } = await import("@/app/api/sante/route");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, cause: "base", commit: "0123456" });
  });

  it.each(["", "pas-un-sha", "0123xyz", "012345"])(
    "valeur %j : champ absent, jamais une valeur inventée",
    async (valeur) => {
      vi.stubEnv("VERCEL_GIT_COMMIT_SHA", valeur);
      baseOk();
      const { GET } = await import("@/app/api/sante/route");
      expect(await (await GET()).json()).toEqual({ ok: true });
    },
  );

  it("variable absente (local) : champ absent", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined as unknown as string);
    baseOk();
    const { GET } = await import("@/app/api/sante/route");
    expect(await (await GET()).json()).toEqual({ ok: true });
  });
});
