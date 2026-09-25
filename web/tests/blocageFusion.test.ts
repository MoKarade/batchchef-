// Blocage technique de l'auto-fusion (lot pole-architecture) : une PR qui touche un chemin sensible ne s'arme
// jamais, et une PR déjà armée qui en touche un se désarme. La décision est le modèle de l'Atelier
// (modeles/auto-merge/, copié à l'identique dans .github/scripts/auto-merge/) ; ici on vérifie qu'il est
// branché sur les chemins de BatchChef et que le workflow l'obéit.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHEMINS_INTERDITS, peutArmer, type FichierPR } from "../../.github/scripts/auto-merge/autoMerge.mjs";

const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), "utf8");
const config = JSON.parse(lire(".github/auto-merge.json"));
const workflow = lire(".github/workflows/fusion-auto.yml");

const pr = (fichiers: (string | FichierPR)[], extra: Record<string, unknown> = {}) => ({
  isDraft: false,
  isCrossRepository: false,
  labels: [],
  fichiers,
  ...extra,
});

describe("chemins sensibles : jamais armés", () => {
  const sensibles = [
    "scripts/hooks/pre.js",
    ".github/workflows/ci.yml",
    ".github/auto-merge.json",
    "web/settings.json",
    ".claude/settings.local.json",
    "web/commit-gate.mjs",
    "passerelle/tunnel.yml",
    "CODEOWNERS",
    ".github/CODEOWNERS",
    "modeles/auto-merge/autoMerge.mjs",
    "web/drizzle/0003_nouvelle.sql",
    "web/lib/db/schema.ts",
    "web/lib/db/index.ts",
    ".GitHub/workflows/x.yml",
  ];
  it.each(sensibles)("%s", (chemin) => {
    const r = peutArmer(pr([chemin]), config);
    expect(r.armer).toBe(false);
    expect(r.raison).not.toMatch(/configuration invalide/);
  });

  it("un chemin sensible parmi d'autres suffit à refuser", () => {
    expect(peutArmer(pr(["web/app/page.tsx", "web/lib/db/schema.ts"]), config).armer).toBe(false);
  });

  it("un renommage depuis un chemin sensible refuse aussi", () => {
    const f = [{ path: "web/lib/x.ts", previous_filename: "web/lib/db/schema.ts", status: "renamed" }];
    expect(peutArmer(pr(f), config).armer).toBe(false);
  });
});

describe("PR ordinaires", () => {
  it("une PR de code ordinaire avec un test ajouté peut s'armer", () => {
    const f = [
      { path: "web/lib/aggregate.ts", status: "modified", patch: "+x" },
      { path: "web/tests/aggregate.test.ts", status: "added", patch: "+expect(1).toBe(1)" },
    ];
    expect(peutArmer(pr(f), config).armer).toBe(true);
  });

  it("un brouillon, un fork, un label do-not-merge ou validation-marc ne s'arment pas", () => {
    const f = ["web/README.md"];
    expect(peutArmer(pr(f, { isDraft: true }), config).armer).toBe(false);
    expect(peutArmer(pr(f, { isCrossRepository: true }), config).armer).toBe(false);
    expect(peutArmer(pr(f, { labels: [{ name: "do-not-merge" }] }), config).armer).toBe(false);
    expect(peutArmer(pr(f, { labels: [{ name: "validation-marc" }] }), config).armer).toBe(false);
  });

  it("liste de fichiers vide ou illisible : refus (échec fermé)", () => {
    expect(peutArmer(pr([]), config).armer).toBe(false);
    expect(peutArmer({ ...pr(["a"]), fichiers: undefined }, config).armer).toBe(false);
  });
});

describe("le modèle est branché", () => {
  it("la liste de l'Atelier couvre les chemins demandés", () => {
    for (const m of ["scripts/hooks/**", ".github/**", "**/settings*", "**/commit-gate*", "passerelle/tunnel.yml", ".claude/**", "CODEOWNERS", "modeles/**"]) {
      expect(CHEMINS_INTERDITS).toContain(m);
    }
  });

  it("la configuration ajoute la base (migrations, schéma) sans rien retirer", () => {
    expect(config.chemins_interdits).toEqual(expect.arrayContaining(["web/drizzle/**", "web/lib/db/**"]));
  });
});

describe("workflow fusion-auto.yml", () => {
  it("lit le workflow et la liste depuis la branche de base (pull_request_target), jamais depuis la PR", () => {
    expect(workflow).toMatch(/^\s*pull_request_target:/m);
    expect(workflow).not.toMatch(/^\s*pull_request:/m);
    expect(workflow).not.toMatch(/^\s*ref:/m);
  });

  it("se réévalue à chaque poussée pour désarmer une PR armée qui touche un chemin sensible", () => {
    expect(workflow).toMatch(/synchronize/);
    expect(lire(".github/scripts/auto-merge/armer.mjs")).toMatch(/--disable-auto/);
  });

  it("n'arme qu'après la décision du modèle (plus de « gh pr merge --auto » nu)", () => {
    expect(workflow).toMatch(/armer\.mjs/);
    expect(workflow).not.toMatch(/run:\s*gh pr merge --auto/);
  });

  it("ne fait aucun checkout du code de la PR", () => {
    expect(workflow).toMatch(/persist-credentials:\s*false/);
  });
});
