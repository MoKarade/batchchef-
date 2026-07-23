// Normalisation des unités brutes Marmiton → g/ml/unite. Discriminants : conversions
// volumétriques (cl/dl/l/tasse), cuillères désambiguïsées par le texte, « pincée » et
// unités inconnues → « au goût » (jamais un poids inventé), qty ≤ 0 rejetée.

import { describe, expect, it } from "vitest";
import { normalizeQty } from "../lib/units";

describe("normalizeQty", () => {
  it("garde g/ml/unite tels quels", () => {
    expect(normalizeQty(80, "g")).toEqual({ qty: 80, unit: "g" });
    expect(normalizeQty(2, "unite")).toEqual({ qty: 2, unit: "unite" });
    expect(normalizeQty(250, "ml")).toEqual({ qty: 250, unit: "ml" });
  });
  it("convertit les masses et volumes vers g/ml", () => {
    expect(normalizeQty(1.5, "kg")).toEqual({ qty: 1500, unit: "g" });
    expect(normalizeQty(10, "cl")).toEqual({ qty: 100, unit: "ml" });
    expect(normalizeQty(2, "dl")).toEqual({ qty: 200, unit: "ml" });
    expect(normalizeQty(0.5, "l")).toEqual({ qty: 500, unit: "ml" });
    expect(normalizeQty(1, "tasse")).toEqual({ qty: 250, unit: "ml" });
  });
  it("désambiguïse les cuillères via le texte brut (thé=5ml, soupe=15ml)", () => {
    expect(normalizeQty(2, "cuillères", "2 cuillères à soupe d'huile")).toEqual({ qty: 30, unit: "ml" });
    expect(normalizeQty(1, "cuillères", "1 cuillère à thé de sel")).toEqual({ qty: 5, unit: "ml" });
    expect(normalizeQty(1, "cuillère", "1 cuillère à café")).toEqual({ qty: 5, unit: "ml" });
  });
  it("« pincée » et unité inconnue → au goût (jamais de poids inventé)", () => {
    expect(normalizeQty(1, "pincée")).toEqual({ qty: null, unit: null });
    expect(normalizeQty(3, "poignée")).toEqual({ qty: null, unit: null });
  });
  it("quantité absente ou ≤ 0 → au goût", () => {
    expect(normalizeQty(null, "g")).toEqual({ qty: null, unit: null });
    expect(normalizeQty(0, "g")).toEqual({ qty: null, unit: null });
    expect(normalizeQty(-5, "g")).toEqual({ qty: null, unit: null });
  });
});
