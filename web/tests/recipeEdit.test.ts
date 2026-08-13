// Édition de recette : nettoyage des lignes saisies (canonical, cohérence qty/unit,
// bornage des portions) — la garantie « 100 % précis » repose sur cette correction.

import { describe, expect, it } from "vitest";
import { clampServings, normaliserLienSource, prepareIngredientRows } from "../lib/recipeEdit";

describe("normaliserLienSource", () => {
  it("garde un lien http(s) et le normalise", () => {
    expect(normaliserLienSource("https://www.instagram.com/reel/abc")).toEqual({
      lien: "https://www.instagram.com/reel/abc",
      valide: true,
    });
    expect(normaliserLienSource("  http://exemple.test/r  ").lien).toBe("http://exemple.test/r");
  });

  it("champ vide = pas de lien, et c'est un état NORMAL, pas une erreur", () => {
    expect(normaliserLienSource("")).toEqual({ lien: null, valide: true });
    expect(normaliserLienSource(null)).toEqual({ lien: null, valide: true });
    expect(normaliserLienSource("   ")).toEqual({ lien: null, valide: true });
  });

  it("refuse tout schéma exécutable — ce lien devient un <a href> sur la page", () => {
    // Depuis que le lien est ÉDITABLE à l'écran de validation, il n'est plus filtré par le
    // chemin d'import. Sans cette garde, un « javascript:… » collé par mégarde deviendrait
    // un lien exécutable sur la page de recette.
    for (const mauvais of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "pas une url",
    ]) {
      expect(normaliserLienSource(mauvais)).toEqual({ lien: null, valide: false });
    }
  });
});

describe("clampServings", () => {
  it("borne à un entier 1…50", () => {
    expect(clampServings(0)).toBe(1);
    expect(clampServings(3.7)).toBe(4);
    expect(clampServings(999)).toBe(50);
    expect(clampServings(Number.NaN)).toBe(1);
  });
});

describe("prepareIngredientRows", () => {
  it("dérive le canonical du nom et trime", () => {
    const rows = prepareIngredientRows([
      { name: "  Poitrines de Poulet ", qty: 500, unit: "g", note: " désossées " },
    ]);
    expect(rows[0]).toEqual({
      name: "Poitrines de Poulet",
      canonical: "poitrines de poulet",
      qty: 500,
      unit: "g",
      note: "désossées",
    });
  });

  it("« au goût » : qty ≤ 0 ou nulle → qty ET unit à null", () => {
    expect(prepareIngredientRows([{ name: "Sel", qty: null, unit: "g", note: null }])[0]).toMatchObject({
      qty: null,
      unit: null,
    });
    expect(prepareIngredientRows([{ name: "Poivre", qty: 0, unit: "g", note: null }])[0]).toMatchObject({
      qty: null,
      unit: null,
    });
  });

  it("ignore une ligne sans nom (jamais un ingrédient vide en base)", () => {
    const rows = prepareIngredientRows([
      { name: "   ", qty: 100, unit: "g", note: null },
      { name: "Farine", qty: 200, unit: "g", note: null },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Farine");
  });

  it("note vide → null", () => {
    expect(prepareIngredientRows([{ name: "Riz", qty: 300, unit: "g", note: "  " }])[0]?.note).toBeNull();
  });
});
