// Schémas LLM : un JSON hors contrat est REJETÉ (jamais un état sale en base),
// et htmlToText nettoie sans perdre les URLs d'images candidates.

import { describe, expect, it } from "vitest";
import { CostEstimateSchema, ParsedRecipeSchema, htmlToText } from "../lib/llm";

describe("ParsedRecipeSchema", () => {
  const valid = {
    title: "Poulet au beurre",
    servings: 4,
    imageUrl: null,
    instructions: "Cuire.",
    ingredients: [
      { name: "Poulet", canonical: "poulet", qty: 500, unit: "g", note: null },
    ],
  };

  it("accepte une recette bien formée", () => {
    expect(ParsedRecipeSchema.parse(valid).title).toBe("Poulet au beurre");
  });
  it("rejette une unité non normalisée (tasse, kg…)", () => {
    expect(() =>
      ParsedRecipeSchema.parse({
        ...valid,
        ingredients: [{ ...valid.ingredients[0], unit: "tasse" }],
      }),
    ).toThrow();
  });
  it("rejette une recette sans ingrédient ou aux portions absurdes", () => {
    expect(() => ParsedRecipeSchema.parse({ ...valid, ingredients: [] })).toThrow();
    expect(() => ParsedRecipeSchema.parse({ ...valid, servings: 0 })).toThrow();
  });
});

describe("CostEstimateSchema", () => {
  it("borne les coûts (0…500 $) et admet null (« je ne sais pas »)", () => {
    expect(
      CostEstimateSchema.parse({ items: [{ canonical: "riz", estCost: null }] }).items,
    ).toHaveLength(1);
    expect(() =>
      CostEstimateSchema.parse({ items: [{ canonical: "riz", estCost: -1 }] }),
    ).toThrow();
  });
});

describe("htmlToText", () => {
  it("supprime scripts/styles/tags mais garde le texte et les URLs d'images", () => {
    const html = `<html><script>evil()</script><style>.x{}</style>
      <h1>Tarte</h1><img src="https://ex.com/tarte.jpg"><p>4 portions</p></html>`;
    const text = htmlToText(html);
    expect(text).toContain("Tarte");
    expect(text).toContain("[image: https://ex.com/tarte.jpg]");
    expect(text).not.toContain("evil");
  });
  it("borne la taille (le LLM n'a pas besoin de 2 Mo de HTML)", () => {
    expect(htmlToText("a".repeat(100000), 500).length).toBe(500);
  });
});
