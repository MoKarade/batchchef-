// Blocage technique de l'auto-fusion : une PR qui touche un chemin sensible ne s'arme jamais sans l'attestation de
// pole-securite, et une PR déjà armée qui en touche un se désarme. La décision est le modèle de l'Atelier
// (modeles/auto-merge/, copies EXACTES vérifiées par COPIES.md) ; ici on vérifie qu'il est branché sur les chemins
// de BatchChef (.github/auto-merge.json) et que les workflows respectent la grille de relecture sécurité.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHEMINS_INTERDITS, peutArmer, type FichierPR } from "../../modeles/auto-merge/autoMerge.mjs";

const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), "utf8");
const config = JSON.parse(lire(".github/auto-merge.json"));
const armement = lire(".github/workflows/armement-auto-merge.yml");
const fusion = lire(".github/workflows/auto-merge.yml");

const pr = (fichiers: (string | FichierPR)[], extra: Record<string, unknown> = {}) => ({
  isDraft: false,
  isCrossRepository: false,
  labels: [],
  fichiers,
  ...extra,
});

describe("chemins sensibles : jamais armés sans attestation", () => {
  const sensibles = [
    "scripts/hooks/pre.js",
    "web/scripts/hooks/pre.js",
    ".github/workflows/ci.yml",
    ".github/auto-merge.json",
    ".claude/settings.local.json",
    "web/commit-gate.mjs",
    "CODEOWNERS",
    ".github/CODEOWNERS",
    "modeles/auto-merge/autoMerge.mjs",
    "CLAUDE.md",
    ".gitattributes",
    "web/drizzle/0003_nouvelle.sql",
    "web/drizzle/meta/_journal.json",
    "web/lib/db/schema.ts",
    "web/lib/db/index.ts",
    "web/drizzle.config.ts",
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

  it("les migrations et le schéma ne sont PAS attestables : ils sont dans chemins_interdits (Marc décide)", () => {
    expect(config.chemins_interdits).toEqual(expect.arrayContaining(["web/drizzle/**", "web/lib/db/**"]));
  });
});

describe("chemins BatchChef qui portent la sécurité : attestation requise", () => {
  const racine = new URL("../../", import.meta.url);
  it.each([
    "web/middleware.ts",
    "web/auth.ts",
    "web/lib/authGuard.ts",
    "web/lib/authorized.ts",
    "web/lib/authConfigured.ts",
    "web/app/api/auth/[...nextauth]/route.ts",
    "web/app/api/mcp/route.ts",
    "web/lib/mcp/oauthStore.ts",
    "web/lib/accesHub.ts",
    "web/vercel.json",
    "web/next.config.ts",
    "web/scripts/build-necessaire.sh",
    "web/scripts/vercel-build.mjs",
    "web/tests/vercelBuild.test.ts",
    "web/tests/deploiement.test.ts",
    "web/tests/blocageFusion.test.ts",
  ])("%s ne s'arme pas SANS attestation de pole-securite", (chemin) => {
    expect(peutArmer(pr([chemin]), config).armer).toBe(false);
  });

  it("les motifs sans joker désignent des fichiers qui existent (aucun chemin inventé)", () => {
    const motifs: string[] = [...config.chemins_label_validation, ...config.chemins_interdits];
    for (const m of motifs.filter((x) => !x.includes("*"))) expect(existsSync(new URL(m, racine)), m).toBe(true);
    for (const m of motifs.filter((x) => x.endsWith("/**"))) expect(existsSync(new URL(m.slice(0, -3), racine)), m).toBe(true);
  });

  it("securite_login est configuré via une GitHub App (login en [bot] ET identifiant numérique obligatoire)", () => {
    expect(config.securite_login).toMatch(/^[A-Za-z0-9-]+\[bot\]$/);
    expect(Number.isInteger(config.securite_user_id) && config.securite_user_id > 0).toBe(true);
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

  it("un brouillon, un fork, un label do-not-merge ne s'arment pas", () => {
    const f = ["web/README.md"];
    expect(peutArmer(pr(f, { isDraft: true }), config).armer).toBe(false);
    expect(peutArmer(pr(f, { isCrossRepository: true }), config).armer).toBe(false);
    expect(peutArmer(pr(f, { labels: [{ name: "do-not-merge" }] }), config).armer).toBe(false);
  });

  it("liste de fichiers vide ou illisible : refus (échec fermé)", () => {
    expect(peutArmer(pr([]), config).armer).toBe(false);
    expect(peutArmer({ ...pr(["a"]), fichiers: undefined }, config).armer).toBe(false);
  });
});

describe("le modèle est branché", () => {
  it("la liste de base couvre les chemins génériques", () => {
    for (const m of [".github/**", "**/commit-gate*", ".claude/**", "CODEOWNERS", "modeles/**", "**/scripts/hooks/**"]) {
      expect(CHEMINS_INTERDITS).toContain(m);
    }
  });

  it("controles_requis = les noms exacts des jobs de ci.yml (un nom faux bloquerait toute fusion)", () => {
    const ci = lire(".github/workflows/ci.yml");
    for (const nom of config.controles_requis as string[]) expect(ci, nom).toContain(`name: ${nom}`);
  });

  it("branche_base = master", () => {
    expect(config.branche_base).toBe("master");
  });

  it("la surcouche de l'Atelier n'est JAMAIS copiée ici", () => {
    expect(existsSync(new URL("../../modeles/auto-merge/chemins-interdits-atelier.json", import.meta.url))).toBe(false);
  });

  it("COPIES.md atteste chaque copie (une ligne par fichier), l'ancienne copie adaptée a disparu", () => {
    const copies = lire("COPIES.md");
    for (const f of ["modeles/auto-merge/autoMerge.mjs", "modeles/auto-merge/armer.mjs", ".github/workflows/armement-auto-merge.yml"]) {
      expect(copies, f).toContain(`| ${f} |`);
    }
    expect(existsSync(new URL("../../.github/scripts", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../../.github/workflows/fusion-auto.yml", import.meta.url))).toBe(false);
  });
});

describe("workflow armement-auto-merge.yml (checklist pole-securite)", () => {
  it("pull_request_target : workflow et code lus sur la base, jamais sur la PR", () => {
    expect(armement).toMatch(/^\s*pull_request_target:/m);
    expect(armement).not.toMatch(/^\s*pull_request:/m);
    expect(armement).not.toMatch(/^\s*pull_request_review:/m);
    expect(armement).toMatch(/ref:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha/);
  });

  it("types complets : un label ou un brouillon désarme", () => {
    const types = /types:\s*\[([^\]]*)\]/.exec(armement)?.[1]?.split(",").map((t) => t.trim()) ?? [];
    for (const t of ["opened", "reopened", "ready_for_review", "synchronize", "labeled", "unlabeled", "edited", "converted_to_draft"]) expect(types).toContain(t);
  });

  it("chaque action est épinglée par SHA de commit complet", () => {
    const usages = [...armement.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1] ?? "");
    expect(usages.length).toBeGreaterThan(0);
    for (const u of usages) expect(u, u).toMatch(/@[0-9a-f]{40}$/);
  });

  it("permissions {} globales, droits au niveau du job seulement, filtre sur le dépôt de la tête, échec fermé", () => {
    expect(armement).toMatch(/^permissions:\s*\{\}\s*$/m);
    expect(armement).toMatch(/github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
    expect(armement).toMatch(/if:\s*failure\(\)/);
    expect(armement).toMatch(/--disable-auto/);
  });
});

describe("workflow auto-merge.yml (fusion évènementielle, Dependabot compris)", () => {
  it("attend la CI de ce dépôt (son nom exact) et n'utilise jamais pull_request_review", () => {
    expect(fusion).toMatch(/workflows:\s*\[CI\]/);
    expect(lire(".github/workflows/ci.yml")).toMatch(/^name:\s*CI\s*$/m);
    expect(fusion).not.toMatch(/^\s*pull_request_review:/m);
  });

  it("actions épinglées par SHA, permissions {} globales", () => {
    const usages = [...fusion.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1] ?? "");
    expect(usages.length).toBeGreaterThan(0);
    for (const u of usages) expect(u, u).toMatch(/@[0-9a-f]{40}$/);
    expect(fusion).toMatch(/^permissions:\s*\{\}\s*$/m);
  });
});
