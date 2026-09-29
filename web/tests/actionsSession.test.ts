// Verrou M2 (audit pole-securite) : TOUT export d'un fichier "use server" est une Server
// Action, donc un point d'entrée appelable depuis le navigateur. D'où deux règles, prouvées ici :
//   1. une fonction de TRAVAIL (`*Interne`, sans contrôle d'accès) ne vit JAMAIS dans un
//      fichier "use server" ;
//   2. chaque Server Action refuse sans session, AVANT de toucher la base ou le travail.
// Aucune donnée métier : la base est remplacée par un piège qui échoue si on la touche.

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => auth(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Piège : n'importe quel accès à la base pendant un refus ferait échouer le test.
const baseTouchee = vi.fn();
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const db = new Proxy(
    {},
    {
      get(_c, prop) {
        baseTouchee(prop);
        throw new Error(`base touchée (${String(prop)})`);
      },
    },
  );
  return { db, schema };
});

const creerBatchInterne = vi.fn();
const ajouterDuCatalogueInterne = vi.fn();
const cocherArticleInterne = vi.fn();
vi.mock("@/lib/actionsInternes/batch", () => ({
  creerBatchInterne: (...a: unknown[]) => creerBatchInterne(...a),
}));
vi.mock("@/lib/actionsInternes/catalogue", () => ({
  ajouterDuCatalogueInterne: (...a: unknown[]) => ajouterDuCatalogueInterne(...a),
}));
vi.mock("@/lib/actionsInternes/courses", () => ({
  cocherArticleInterne: (...a: unknown[]) => cocherArticleInterne(...a),
}));

import * as assistant from "@/lib/actions/assistant";
import * as batch from "@/lib/actions/batch";
import * as catalogue from "@/lib/actions/catalogue";
import * as courses from "@/lib/actions/courses";
import * as importRecette from "@/lib/actions/import";
import * as recettes from "@/lib/actions/recettes";
import * as semaine from "@/lib/actions/semaine";

const MODULES_ACTIONS: Record<string, Record<string, unknown>> = {
  assistant,
  batch,
  catalogue,
  courses,
  import: importRecette,
  recettes,
  semaine,
};

const RACINE = resolve(process.cwd());
const lire = (chemin: string): string => readFileSync(join(RACINE, chemin), "utf8");
const fichiersTs = (dossier: string): string[] =>
  readdirSync(join(RACINE, dossier))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `${dossier}/${f}`);

/** Tous les fichiers .ts/.tsx de app/, lib/ et components/ (récursif). */
function toutLeCode(): string[] {
  const res: string[] = [];
  for (const dossier of ["app", "lib", "components"]) {
    for (const e of readdirSync(join(RACINE, dossier), { recursive: true, withFileTypes: true })) {
      if (e.isFile() && /\.tsx?$/.test(e.name)) res.push(join(e.parentPath, e.name));
    }
  }
  return res;
}

/** Directive de fichier, même précédée de commentaires (sinon un fichier fautif passerait inaperçu). */
const estUseServer = (code: string): boolean =>
  /^["']use server["'];?/.test(code.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, ""));

/** Tout export dont le nom finit en `…Interne` : fonction, constante ou ré-export (renommé ou non). */
const EXPORT_INTERNE =
  /export\s+(async\s+)?function\s+\w*Interne|export\s+(const|let|var)\s+\w*Interne|export\s*\{[^}]*Interne/;

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue(null);
});

describe("structure : les fonctions de travail ne sont jamais des Server Actions", () => {
  it("chaque fichier de lib/actions/ est \"use server\" et n'exporte aucun *Interne", () => {
    const fichiers = fichiersTs("lib/actions");
    expect(fichiers.length).toBe(Object.keys(MODULES_ACTIONS).length);
    for (const f of fichiers) {
      const code = lire(f);
      expect(estUseServer(code), f).toBe(true);
      expect(code, f).not.toMatch(EXPORT_INTERNE);
    }
  });

  it("aucun fichier \"use server\" de l'app n'exporte un *Interne", () => {
    const fautifs = toutLeCode().filter((f) => {
      const code = readFileSync(f, "utf8");
      return estUseServer(code) && EXPORT_INTERNE.test(code);
    });
    expect(fautifs).toEqual([]);
  });

  it("le détecteur reconnaît chaque forme d'export fautive", () => {
    expect(estUseServer('// commentaire\n/* bloc */\n"use server";\n')).toBe(true);
    expect(estUseServer('import x from "y";\n"use server";')).toBe(false);
    for (const fautif of [
      "export async function creerInterne() {}",
      "export const creerInterne = async () => {};",
      "export { a as creerInterne };",
    ]) {
      expect(EXPORT_INTERNE.test(fautif), fautif).toBe(true);
    }
  });

  it("lib/actionsInternes/ n'est jamais \"use server\"", () => {
    for (const f of fichiersTs("lib/actionsInternes")) {
      expect(estUseServer(lire(f)), f).toBe(false);
    }
  });

  it("chaque Server Action vérifie la session AVANT tout autre await", () => {
    for (const f of fichiersTs("lib/actions")) {
      const code = lire(f);
      const blocs = code.split(/(?=export async function )/).slice(1);
      expect(blocs.length, f).toBeGreaterThan(0);
      for (const bloc of blocs) {
        const nom = /export async function (\w+)/.exec(bloc)?.[1];
        expect(bloc.indexOf("await "), `${f} › ${nom}`).toBe(bloc.indexOf("await requireSession()"));
      }
    }
  });
});

describe("comportement : sans session, chaque Server Action refuse sans rien toucher", () => {
  const actions = Object.entries(MODULES_ACTIONS).flatMap(([mod, m]) =>
    Object.entries(m)
      .filter(([, v]) => typeof v === "function")
      .map(([nom, fn]) => ({ id: `${mod}.${nom}`, fn: fn as (...a: unknown[]) => Promise<unknown> })),
  );

  it("au moins une action par module est éprouvée", () => {
    expect(actions.length).toBeGreaterThanOrEqual(Object.keys(MODULES_ACTIONS).length);
  });

  it.each(actions)("$id refuse sans session", async ({ fn }) => {
    const r = await fn();
    expect(r).toEqual({ ok: false, error: "Session requise." });
    expect(baseTouchee).not.toHaveBeenCalled();
    expect(creerBatchInterne).not.toHaveBeenCalled();
    expect(ajouterDuCatalogueInterne).not.toHaveBeenCalled();
    expect(cocherArticleInterne).not.toHaveBeenCalled();
  });
});

describe("comportement : avec session, les points d'entrée délèguent au travail", () => {
  beforeEach(() => {
    auth.mockResolvedValue({ user: { email: "session-de-test" } });
  });

  it("createBatch transmet la saisie telle quelle et rend le résultat du travail", async () => {
    creerBatchInterne.mockResolvedValue({ ok: true, id: 3 });
    const saisie = { name: "batch-test", selections: [{ recipeId: 1, portions: 2 }] };
    expect(await batch.createBatch(saisie)).toEqual({ ok: true, id: 3 });
    expect(creerBatchInterne).toHaveBeenCalledWith(saisie);
  });

  it("toggleShoppingItem transmet l'article et l'état", async () => {
    cocherArticleInterne.mockResolvedValue({ ok: true });
    expect(await courses.toggleShoppingItem(5, true)).toEqual({ ok: true });
    expect(cocherArticleInterne).toHaveBeenCalledWith(5, true);
  });

  it("addCatalogRecipesToLibrary transmet la sélection", async () => {
    ajouterDuCatalogueInterne.mockResolvedValue({ ok: true, added: 1, skipped: 0 });
    expect(await catalogue.addCatalogRecipesToLibrary([7])).toEqual({ ok: true, added: 1, skipped: 0 });
    expect(ajouterDuCatalogueInterne).toHaveBeenCalledWith([7]);
  });

  it("une exception du travail est rendue comme échec honnête", async () => {
    creerBatchInterne.mockRejectedValue(new Error("panne de test"));
    expect(await batch.createBatch({ name: "x", selections: [] })).toEqual({ ok: false, error: "panne de test" });
  });
});
