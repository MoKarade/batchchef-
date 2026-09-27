// Garde de `vercel-build` : les migrations et la réparation ne touchent la base (UNE seule, celle de la production)
// que sur un build de PRODUCTION. Échec fermé : variable absente ou inconnue = on ne touche pas la base.
import { mkdtempSync, chmodSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, delimiter } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { etapesDeBuild, cheminSecurise } from "../scripts/vercel-build.mjs";

const NOMS = (env: Record<string, string | undefined>) => etapesDeBuild(env).etapes.map((e) => e.nom);

describe("etapesDeBuild", () => {
  it("production : migre, répare, puis construit (dans cet ordre)", () => {
    expect(NOMS({ VERCEL_ENV: "production" })).toEqual(["db:migrate", "db:reparer-ingredients", "build"]);
  });

  it.each(["preview", "development"])("%s : saute la base, construit seulement, avec une ligne de log claire", (v) => {
    const plan = etapesDeBuild({ VERCEL_ENV: v });
    expect(plan.etapes.map((e) => e.nom)).toEqual(["build"]);
    expect(plan.message).toBe("préversion : migrations et réparation sautées");
  });

  it("variable absente : saute la base (échec fermé)", () => {
    expect(NOMS({})).toEqual(["build"]);
    expect(etapesDeBuild({}).message).toContain("migrations et réparation sautées");
  });

  it.each(["", " ", "Production", "PRODUCTION", "prod", "production ", "staging"])("valeur %j : saute la base", (v) => {
    expect(NOMS({ VERCEL_ENV: v })).toEqual(["build"]);
  });

  it("le message de production dit que la base est touchée", () => {
    expect(etapesDeBuild({ VERCEL_ENV: "production" }).message).toMatch(/production/);
  });

  it("ne modifie pas l'environnement reçu", () => {
    const env = Object.freeze({ VERCEL_ENV: "production" });
    expect(() => etapesDeBuild(env)).not.toThrow();
  });
});

describe("sur Vercel (VERCEL=1) sans VERCEL_ENV : le build échoue", () => {
  it.each([undefined, "", "  "])("VERCEL=1 et VERCEL_ENV=%j : erreur claire, aucune étape", (v) => {
    const plan = etapesDeBuild({ VERCEL: "1", VERCEL_ENV: v });
    expect(plan.etapes).toEqual([]);
    expect(plan.erreur).toMatch(/VERCEL_ENV absente sur Vercel/);
    expect(plan.erreur).toMatch(/variables système/);
  });

  it("VERCEL=1 + preview : saute la base, pas d'erreur", () => {
    const plan = etapesDeBuild({ VERCEL: "1", VERCEL_ENV: "preview" });
    expect(plan.erreur).toBeUndefined();
    expect(plan.etapes.map((e) => e.nom)).toEqual(["build"]);
  });

  it("VERCEL=1 + production : migre, répare, construit", () => {
    const plan = etapesDeBuild({ VERCEL: "1", VERCEL_ENV: "production" });
    expect(plan.erreur).toBeUndefined();
    expect(plan.etapes.map((e) => e.nom)).toEqual(["db:migrate", "db:reparer-ingredients", "build"]);
  });

  it("VERCEL absent (poste local) : build seul, sans erreur", () => {
    const plan = etapesDeBuild({});
    expect(plan.erreur).toBeUndefined();
    expect(plan.etapes.map((e) => e.nom)).toEqual(["build"]);
  });

  it("VERCEL d'une autre valeur que « 1 » : traité comme local (comportement inchangé)", () => {
    expect(etapesDeBuild({ VERCEL: "0" }).erreur).toBeUndefined();
  });
});

describe("lien avec package.json", () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };

  it("`vercel-build` appelle la garde, pas les commandes de base en direct", () => {
    const chaine = pkg.scripts["vercel-build"] ?? "";
    expect(chaine).toContain("scripts/vercel-build.mjs");
    expect(chaine).not.toContain("db:migrate");
    expect(chaine).not.toContain("db:reparer-ingredients");
  });

  it("les scripts que la garde lance existent dans package.json", () => {
    for (const nom of ["db:migrate", "db:reparer-ingredients", "build"]) expect(pkg.scripts[nom], nom).toBeTruthy();
  });
});

describe("cheminSecurise (SonarCloud S4036 : PATH ne doit chercher npm que dans des dossiers fixes, non inscriptibles)", () => {
  const dossiersACreer: string[] = [];
  afterEach(() => {
    for (const d of dossiersACreer.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("Windows : PATH inchangé (pas de bits Unix à vérifier)", () => {
    const original = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      expect(cheminSecurise(`C:\\a${delimiter}C:\\b`)).toBe(`C:\\a${delimiter}C:\\b`);
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  });

  it("PATH vide ou absent : chaîne vide, sans lever", () => {
    if (process.platform === "win32") return; // la branche Windows ne filtre rien ; rien à éprouver ici
    expect(cheminSecurise(undefined)).toBe("");
    expect(cheminSecurise("")).toBe("");
  });

  it("un dossier absent du disque est retiré (jamais d'exception)", () => {
    if (process.platform === "win32") return;
    expect(cheminSecurise("/un/dossier/qui/n/existe/pas")).toBe("");
  });

  it("un dossier non inscriptible par le groupe ou par tous est gardé ; un dossier inscriptible est retiré", () => {
    if (process.platform === "win32") return; // pertinent seulement sur POSIX (Vercel = Linux)
    const sur = mkdtempSync(join(tmpdir(), "batchchef-path-sur-"));
    chmodSync(sur, 0o755); // rwxr-xr-x : personne d'autre que le propriétaire ne peut y écrire
    const dangereux = mkdtempSync(join(tmpdir(), "batchchef-path-danger-"));
    chmodSync(dangereux, 0o777); // rwxrwxrwx : n'importe qui pourrait y glisser un faux `npm`
    dossiersACreer.push(sur, dangereux);

    const resultat = cheminSecurise([sur, dangereux].join(delimiter));

    expect(resultat.split(delimiter)).toEqual([sur]);
  });
});
