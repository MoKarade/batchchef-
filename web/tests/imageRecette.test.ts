// Garde de SURFACE des images de recettes (CAT-G).
//
// Il n'y a rien de pur à tester ici : la valeur du lot est qu'aucune image de recette ne
// soit rendue sans repli. C'est exactement le genre de régression qu'un test unitaire ne
// verrait pas et qu'une relecture laisse passer — et le symptôme, une icône brisée au milieu
// d'une fiche, ne ressemble pas à un bug de code.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fichiers = execFileSync("git", ["ls-files", "--", "app", "components"], {
  cwd: process.cwd(),
  encoding: "utf8",
})
  .split("\n")
  .filter((f) => f.endsWith(".tsx"));

describe("aucune image de recette n'est rendue sans repli", () => {
  it("les `<img>` restants ne servent pas une adresse de recette", () => {
    // `imageUrl` est le champ des recettes (catalogue et bibliothèque). Un `<img>` brut qui
    // le sert est une image qui laissera une icône brisée le jour où le CDN oublie un
    // fichier. Mutation : remettre `<img src={recipe.imageUrl}>` fait tomber ce test.
    const fautifs: string[] = [];
    for (const f of fichiers) {
      const code = readFileSync(resolve(process.cwd(), f), "utf8");
      if (f.endsWith("ImageRecette.tsx")) continue; // c'est LUI, le repli
      for (const ligne of code.split("\n")) {
        if (!/<img\b/.test(ligne)) continue;
        if (/imageUrl|\bsrc=\{(recipe|fiche|cat)\./.test(ligne)) fautifs.push(`${f} : ${ligne.trim()}`);
      }
    }
    expect(fautifs).toEqual([]);
  });

  it("le composant de repli existe, est client, et écoute bien l'échec", () => {
    const code = readFileSync(resolve(process.cwd(), "components/ImageRecette.tsx"), "utf8");
    expect(code.trimStart().startsWith('"use client"')).toBe(true);
    expect(code).toContain("onError");
  });
});
