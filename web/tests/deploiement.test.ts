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

describe("réparation des ingrédients — la passe reste branchée au build", () => {
  // « Promesse de verrou = verrou codé dans le même commit ». La réparation (ING-03) ne vaut
  // que si elle TOURNE : elle est dans `vercel-build`, donc invisible au gate local, donc
  // exactement le genre d'étape qu'un remaniement retire sans que rien ne rougisse.
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  it("`vercel-build` lance la réparation, et AVANT le build", () => {
    const chaine = pkg.scripts["vercel-build"] ?? "";
    expect(chaine).toContain("db:reparer-ingredients");
    // L'ordre compte : réparer après le build laisserait le déploiement servir l'ancien état.
    expect(chaine.indexOf("db:reparer-ingredients")).toBeLessThan(chaine.indexOf("next build"));
    // Et les migrations d'abord : la réparation écrit dans des tables qu'elles créent.
    expect(chaine.indexOf("db:migrate")).toBeLessThan(chaine.indexOf("db:reparer-ingredients"));
  });

  it("le script visé existe vraiment", () => {
    expect(pkg.scripts["db:reparer-ingredients"]).toBeTruthy();
    expect(existsSync(resolve(process.cwd(), "scripts/reparer-ingredients.ts"))).toBe(true);
  });

  it("la passe couvre les TROIS tables où le nom a atterri", () => {
    // Le catalogue est la source, mais les noms se sont propagés : bibliothèque (copie
    // depuis le catalogue) puis liste d'épicerie (copie à la création du batch). N'en
    // réparer qu'une laisserait abîmé précisément ce que Marc regarde.
    const src = readFileSync(resolve(process.cwd(), "scripts/reparer-ingredients.ts"), "utf8");
    for (const table of ["catalogIngredients", "recipeIngredients", "shoppingItems"]) {
      expect(src, table).toContain(table);
    }
  });

  it("la quantité et son UNITÉ sont écrites ENSEMBLE", () => {
    // ⚠️ Vécu le 20/08 : la passe écrivait `qty` et `note`, jamais `unit`. Les six lignes
    // « grandes cuillères » recevaient donc 7,5 tout en gardant `unit='g'` de la colonne
    // fautive — « 7,5 g » au lieu de « 7,5 ml ». Un bon nombre sous une mauvaise unité est
    // PIRE que le défaut d'origine : il a l'air corrigé.
    //
    // Aucun test unitaire ne peut voir ça (la suite n'a pas de base) : c'est un tripwire de
    // surface. Il regarde le `set({...})` de la mise à jour des ingrédients.
    const src = readFileSync(resolve(process.cwd(), "scripts/reparer-ingredients.ts"), "utf8");
    const bloc = /\.update\(tableIngredients\)\s*\.set\(\{([\s\S]*?)\}\)/.exec(src)?.[1];
    expect(bloc, "le bloc de mise à jour des ingrédients doit exister").toBeTruthy();
    for (const champ of ["qty:", "unit:", "note:"]) {
      expect(bloc, `${champ} doit voyager avec les autres`).toContain(champ);
    }
  });

  it("l'import du catalogue répare aussi, sinon il ré-introduirait le défaut", () => {
    // ⚠️ On cherche l'APPEL, pas le nom : une première version de ce test se contentait de
    // `toContain("reparerNom")` et passait au vert alors que l'appel avait été retiré — la
    // ligne d'`import` suffisait à le satisfaire. C'est la mutation qui l'a démasqué.
    // On écarte donc les lignes d'import avant de chercher.
    const src = readFileSync(resolve(process.cwd(), "scripts/import-catalog.ts"), "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("import "))
      .join("\n");
    expect(src, "le nom d'affichage doit passer par reparerNom(...)").toMatch(/reparerNom\s*\(/);
    expect(src, "la clé doit passer par reparerCanonique(...)").toMatch(/reparerCanonique\s*\(/);
  });
});
