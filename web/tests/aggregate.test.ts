// Le cœur de la Phase 1 : l'agrégation de la liste d'épicerie. Discriminants :
// mise à l'échelle par portions, regroupement par canonical+unité, unités
// incompatibles JAMAIS additionnées, « au goût » dédupliqué, formatage fr-CA.

import { describe, expect, it } from "vitest";
import { aggregateShoppingList, formatQty } from "../lib/aggregate";

const ing = (
  canonical: string,
  qty: number | null,
  unit: "g" | "ml" | "unite" | null,
  name = canonical,
) => ({ name, canonical, qty, unit });

describe("aggregateShoppingList", () => {
  it("met à l'échelle selon portions/servings", () => {
    const items = aggregateShoppingList([
      { servings: 4, portions: 8, ingredients: [ing("riz", 200, "g")] },
    ]);
    expect(items).toEqual([{ name: "riz", canonical: "riz", qty: 400, unit: "g" }]);
  });

  it("additionne le même ingrédient entre recettes (même unité)", () => {
    const items = aggregateShoppingList([
      { servings: 4, portions: 4, ingredients: [ing("oignon", 2, "unite")] },
      { servings: 2, portions: 4, ingredients: [ing("oignon", 1, "unite", "Oignons")] },
    ]);
    // 2 + (1 × 4/2) = 4
    expect(items).toEqual([{ name: "oignon", canonical: "oignon", qty: 4, unit: "unite" }]);
  });

  it("ne mélange JAMAIS deux unités incompatibles : deux lignes distinctes", () => {
    const items = aggregateShoppingList([
      {
        servings: 4,
        portions: 4,
        ingredients: [ing("gingembre", 30, "g"), ing("gingembre", 1, "unite")],
      },
    ]);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.unit).sort()).toEqual(["g", "unite"]);
  });

  it("déduplique les « au goût » (qty null) sans inventer de quantité", () => {
    const items = aggregateShoppingList([
      { servings: 4, portions: 8, ingredients: [ing("sel", null, null)] },
      { servings: 2, portions: 6, ingredients: [ing("sel", null, null)] },
    ]);
    expect(items).toEqual([{ name: "sel", canonical: "sel", qty: null, unit: null }]);
  });

  it("normalise le canonical (majuscules/espaces) pour regrouper", () => {
    const items = aggregateShoppingList([
      { servings: 2, portions: 2, ingredients: [ing("Poulet ", 300, "g", "poulet")] },
      { servings: 2, portions: 2, ingredients: [ing("poulet", 200, "g")] },
    ]);
    expect(items).toEqual([{ name: "poulet", canonical: "poulet", qty: 500, unit: "g" }]);
  });

  it("ignore une recette à servings invalide (0) au lieu de diviser par zéro", () => {
    const items = aggregateShoppingList([
      { servings: 0, portions: 4, ingredients: [ing("riz", 200, "g")] },
      { servings: 4, portions: 4, ingredients: [ing("riz", 100, "g")] },
    ]);
    expect(items).toEqual([{ name: "riz", canonical: "riz", qty: 100, unit: "g" }]);
  });

  it("arrondit les unités entamées vers le haut (2,5 oignons → 2,5 affiché, jamais 2)", () => {
    const items = aggregateShoppingList([
      { servings: 4, portions: 5, ingredients: [ing("oignon", 2, "unite")] },
    ]);
    expect(items[0]?.qty).toBe(2.5);
  });
});

describe("formatQty", () => {
  it("bascule g→kg et ml→L à partir de 1000, en fr-CA", () => {
    expect(formatQty(1250, "g")).toContain("kg");
    expect(formatQty(750, "ml")).toBe("750 ml");
    expect(formatQty(null, "g")).toBe("au goût");
  });
});
