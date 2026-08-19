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

describe("CSP — les cibles de formulaire couvrent les flux qui redirigent", () => {
  // La CSP est en Report-Only aujourd'hui : rien ne casse. Ce test protège le JOUR du
  // passage en enforcé, où une directive trop serrée coupe une fonctionnalité SANS erreur
  // visible — c'est la note que DriveAI porte déjà sur sa propre CSP.
  const config = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");

  /**
   * La DIRECTIVE, pas la prose qui en parle.
   *
   * Premier jet de ce test : `.find((l) => l.includes("form-action"))` — qui attrapait le
   * commentaire expliquant la directive, écrit juste au-dessus d'elle. Le test échouait en
   * annonçant que `form-action` n'autorisait pas Google, alors qu'il l'autorisait. On ancre
   * donc sur la forme de la valeur (guillemet + directive + espace), jamais sur le mot.
   */
  const directive = (): string | undefined =>
    config.split("\n").find((l) => l.trimStart().startsWith('"form-action '));

  it("`form-action` autorise Google (connexion) ET Claude (retour du connecteur MCP)", () => {
    const ligne = directive();
    expect(ligne, "directive form-action introuvable").toBeDefined();
    // Google : le formulaire de connexion poste chez lui.
    expect(ligne).toContain("https://accounts.google.com");
    // Claude : la page de consentement poste vers 'self', PUIS redirige vers Claude avec le
    // code. `form-action` couvre cette redirection — l'omettre casserait le branchement à
    // la dernière étape, en silence.
    expect(ligne).toContain("https://claude.ai");
    expect(ligne).toContain("https://claude.com");
  });

  it("les origines de retour sont les MÊMES que l'allowlist du code OAuth", () => {
    // Deux listes qui disent la même chose divergent toujours : celle du code décide qui
    // peut recevoir un code d'autorisation, celle de la CSP décide si le navigateur laisse
    // passer. Un désaccord entre les deux donne un flux qui s'autorise puis se fait bloquer.
    const oauth = readFileSync(resolve(process.cwd(), "lib/mcp/oauth.ts"), "utf8");
    const admises = [...oauth.matchAll(/"(https:\/\/claude\.[a-z]+)"/g)].map((m) => m[1]);
    expect(new Set(admises).size).toBeGreaterThan(0);
    const ligne = directive() ?? "";
    for (const origine of new Set(admises)) {
      expect(ligne, `${origine} est admise par le code OAuth mais absente de form-action`).toContain(
        origine,
      );
    }
  });
});
