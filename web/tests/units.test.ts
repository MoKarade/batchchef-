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

describe("unités ANGLAISES (une partie des reels sont en anglais)", () => {
  it("convertit les masses impériales", () => {
    // Sans ces entrées, chacune de ces quantités tombait en null : la recette paraissait
    // extraite et la liste d'épicerie sortait SANS AUCUN CHIFFRE, sans erreur affichée.
    expect(normalizeQty(8, "oz")).toEqual({ qty: 226.8, unit: "g" });
    expect(normalizeQty(1, "lb")).toEqual({ qty: 453.59, unit: "g" });
    expect(normalizeQty(2, "pounds")).toEqual({ qty: 907.18, unit: "g" });
    expect(normalizeQty(1, "stick")).toEqual({ qty: 113, unit: "g" });
  });

  it("convertit les volumes anglais", () => {
    expect(normalizeQty(2, "cups")).toEqual({ qty: 500, unit: "ml" });
    expect(normalizeQty(1, "tbsp")).toEqual({ qty: 15, unit: "ml" });
    expect(normalizeQty(2, "tsp")).toEqual({ qty: 10, unit: "ml" });
    expect(normalizeQty(1, "fl oz")).toEqual({ qty: 29.57, unit: "ml" });
  });

  it("tolère la ponctuation des abréviations", () => {
    expect(normalizeQty(4, "oz.")).toEqual({ qty: 113.4, unit: "g" });
    expect(normalizeQty(1, "fl. oz.")).toEqual({ qty: 29.57, unit: "ml" });
    expect(normalizeQty(3, "  LBS  ")).toEqual({ qty: 1360.77, unit: "g" });
  });

  it("compte les pièces anglaises", () => {
    expect(normalizeQty(3, "cloves")).toEqual({ qty: 3, unit: "unite" });
    expect(normalizeQty(2, "slices")).toEqual({ qty: 2, unit: "unite" });
  });

  it("REFUSE d'inventer un poids pour un contenant sans taille fixe", () => {
    // Une « can » de tomates peut faire 200 ou 800 g. Un chiffre inventé entrerait dans la
    // liste d'épicerie sans que rien ne le signale : « au goût » est la seule réponse juste.
    for (const flou of ["can", "package", "bunch", "handful", "pinch", "dash"]) {
      expect(normalizeQty(1, flou)).toEqual({ qty: null, unit: null });
    }
  });

  it("n'a pas cassé la désambiguïsation des cuillères françaises", () => {
    // La branche des cuillères s'appuie sur le point de « c. à soupe » : le nettoyage des
    // points ajouté pour « fl. oz. » ne doit pas passer devant elle.
    expect(normalizeQty(1, "c. à soupe", "c. à soupe")).toEqual({ qty: 15, unit: "ml" });
    expect(normalizeQty(1, "c. à thé", "c. à thé")).toEqual({ qty: 5, unit: "ml" });
  });
});
