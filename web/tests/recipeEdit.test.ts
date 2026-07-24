// Édition de recette : nettoyage des lignes saisies (canonical, cohérence qty/unit,
// bornage des portions) — la garantie « 100 % précis » repose sur cette correction.

import { describe, expect, it } from "vitest";
import { clampServings, prepareIngredientRows } from "../lib/recipeEdit";

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
