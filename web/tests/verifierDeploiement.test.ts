// Alerte « merge sans déploiement » (DEPLOI-MUET, #203) : un commit de master sans statut Vercel doit rougir,
// un CANCELED volontaire (commit de doc) doit rester vert. Les statuts ci-dessous sont ceux lus sur GitHub le 21/10/2026.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { attendreDeploiement, jugerStatuts } from "../scripts/verifier-deploiement.mjs";

const PAS_DE_DORS = async () => {};

describe("jugerStatuts", () => {
  it("merge muet (#169) : aucun statut = absent", () => {
    expect(jugerStatuts([]).etat).toBe("absent");
    expect(jugerStatuts(undefined).etat).toBe("absent");
  });

  it("un statut d'un autre service n'est pas un déploiement Vercel", () => {
    expect(jugerStatuts([{ context: "SonarCloud Code Analysis", state: "success" }]).etat).toBe("absent");
  });

  it("déploiement fini (READY) : présent", () => {
    const r = jugerStatuts([{ context: "Vercel", state: "success", description: "Deployment has completed" }]);
    expect(r.etat).toBe("present");
    expect(r.detail).toContain("Deployment has completed");
  });

  it("saut volontaire de build-necessaire.sh (CANCELED) : présent, pas une alerte", () => {
    expect(jugerStatuts([{ context: "Vercel", state: "success", description: "Canceled by Ignored Build Step" }]).etat).toBe("present");
  });

  it("build en cours : le déploiement existe", () => {
    expect(jugerStatuts([{ context: "Vercel", state: "pending", description: "Building" }]).etat).toBe("present");
  });

  it.each(["failure", "error"])("déploiement %s : echec (la production sert l'ancien build)", (state) => {
    expect(jugerStatuts([{ context: "Vercel", state }]).etat).toBe("echec");
  });

  it("projet Vercel nommé (« Vercel – nom ») : reconnu", () => {
    expect(jugerStatuts([{ context: "Vercel – batchchef-glu8", state: "success" }]).etat).toBe("present");
  });
});

describe("attendreDeploiement", () => {
  it("le statut apparaît au 3e essai : rend présent, sans épuiser les essais", async () => {
    let appels = 0;
    const r = await attendreDeploiement({
      lire: async () => (++appels < 3 ? [] : [{ context: "Vercel", state: "pending" }]),
      dormir: PAS_DE_DORS,
      essais: 20,
      pauseMs: 1,
    });
    expect(r).toMatchObject({ etat: "present", essais: 3 });
    expect(appels).toBe(3);
  });

  it("jamais de statut : absent après TOUS les essais (et attend entre deux, pas après le dernier)", async () => {
    const pauses: number[] = [];
    const r = await attendreDeploiement({ lire: async () => [], dormir: async (ms) => void pauses.push(ms), essais: 4, pauseMs: 30_000 });
    expect(r).toMatchObject({ etat: "absent", essais: 4 });
    expect(pauses).toEqual([30_000, 30_000, 30_000]);
  });

  it("déploiement en échec : rendu tout de suite, sans attendre", async () => {
    const r = await attendreDeploiement({ lire: async () => [{ context: "Vercel", state: "failure" }], dormir: PAS_DE_DORS, essais: 20, pauseMs: 1 });
    expect(r).toMatchObject({ etat: "echec", essais: 1 });
  });

  it("une lecture qui échoue est réessayée, puis le statut est trouvé", async () => {
    let appels = 0;
    const r = await attendreDeploiement({
      lire: async () => {
        if (++appels === 1) throw new Error("HTTP 502");
        return [{ context: "Vercel", state: "success" }];
      },
      dormir: PAS_DE_DORS,
      essais: 5,
      pauseMs: 1,
    });
    expect(r.etat).toBe("present");
  });

  it("API illisible à chaque essai : illisible (ni vert, ni preuve d'un merge muet)", async () => {
    const r = await attendreDeploiement({
      lire: async () => {
        throw new Error("HTTP 403");
      },
      dormir: PAS_DE_DORS,
      essais: 3,
      pauseMs: 1,
    });
    expect(r.etat).toBe("illisible");
    expect(r.detail).toContain("HTTP 403");
  });
});

describe("workflow « Déploiement présent »", () => {
  const racine = resolve(process.cwd(), "..");
  const workflow = readFileSync(resolve(racine, ".github/workflows/deploiement-present.yml"), "utf8");
  const reacteur = readFileSync(resolve(racine, ".github/workflows/reacteur.yml"), "utf8");

  it("se lance à chaque push sur master, SANS `paths:` (un commit de doc doit aussi avoir son déploiement ou son CANCELED)", () => {
    expect(workflow).toMatch(/push:\s*\n\s*branches: \[master\]/);
    expect(workflow).not.toMatch(/^\s*paths(-ignore)?:/m);
  });

  it("job borné et jeton en lecture seule", () => {
    expect(workflow).toMatch(/timeout-minutes: \d+/);
    expect(workflow).toMatch(/statuses: read/);
    expect(workflow).not.toMatch(/: write/);
  });

  it("une alerte rouge réveille le Coordinateur, même quand le push vient d'un robot (Mergify)", () => {
    expect(reacteur).toMatch(/workflows: \[CI, "Déploiement présent", "Garde-fou"\]/);
    expect(reacteur).toContain("github.event.workflow_run.name == 'Déploiement présent'");
  });
});
