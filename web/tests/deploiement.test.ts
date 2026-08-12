// Le garde-fou de déploiement : `vercel.json` délègue à un script bash la décision de
// construire ou non. Ce test ne remplace pas la sonde manuelle des deux sens (faite au
// commit qui l'introduit) — il empêche que le script disparaisse, soit renommé, ou perde
// son fail-safe sans que personne ne le voie.
//
// L'enjeu est asymétrique : une erreur dans un sens coûte un déploiement de trop ; dans
// l'autre, elle les supprime TOUS en silence et la production se fige sur un commit ancien
// pendant que la CI reste verte.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const vercel = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
  ignoreCommand?: string;
};

describe("garde-fou de déploiement Vercel", () => {
  it("vercel.json délègue la décision de build à un script", () => {
    expect(vercel.ignoreCommand).toBeTruthy();
  });

  it("le script référencé existe RÉELLEMENT et est versionné", () => {
    // Un `ignoreCommand` qui pointe vers un script absent fait échouer chaque build : la
    // production cesserait d'être mise à jour, et rien dans la CI ne le signalerait.
    const chemin = (vercel.ignoreCommand ?? "").replace(/^bash\s+/, "").trim();
    expect(chemin).toBe("scripts/build-necessaire.sh");
    expect(existsSync(resolve(process.cwd(), chemin))).toBe(true);

    const suivis = execFileSync("git", ["ls-files", "--", "scripts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    expect(suivis).toContain("scripts/build-necessaire.sh");
  });

  it("le script garde son fail-safe : toute incertitude CONSTRUIT", () => {
    const script = readFileSync(resolve(process.cwd(), "scripts/build-necessaire.sh"), "utf8");
    // Historique illisible et diff vide doivent mener à un build, pas à un saut silencieux.
    expect(script).toContain("|| exit 1");
    expect(script).toMatch(/\[ -z "\$DIFF" \] && exit 1/);
    // La branche par défaut du `case` construit : la liste des exemptions reste FERMÉE.
    expect(script).toMatch(/\*\)\s*exit 1/);
  });
});
