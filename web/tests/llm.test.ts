// Schémas LLM : un JSON hors contrat est REJETÉ (jamais un état sale en base),
// et htmlToText nettoie sans perdre les URLs d'images candidates.

import { describe, expect, it } from "vitest";
import {
  CostEstimateSchema,
  RawParsedRecipeSchema,
  alignCosts,
  htmlToText,
  normalizeParsedRecipe,
} from "../lib/llm";

describe("RawParsedRecipeSchema (tolérant) + normalizeParsedRecipe", () => {
  const valid = {
    title: "Poulet au beurre",
    servings: 4,
    imageUrl: null,
    instructions: "Cuire.",
    ingredients: [{ name: "Poulet", canonical: "poulet", qty: 500, unit: "g", note: null }],
  };

  it("accepte les unités BRUTES du LLM et les normalise après (c. à soupe → 15 ml)", () => {
    const norm = normalizeParsedRecipe(
      RawParsedRecipeSchema.parse({
        ...valid,
        ingredients: [{ name: "Huile", canonical: "huile", qty: 2, unit: "c. à soupe", note: null }],
      }),
    );
    expect(norm.ingredients[0]).toMatchObject({ qty: 30, unit: "ml" });
  });

  it("tolère une clé `note` ABSENTE (le bug d'import) et les champs optionnels manquants", () => {
    const norm = normalizeParsedRecipe(
      RawParsedRecipeSchema.parse({
        title: "Quiche",
        servings: 6,
        ingredients: [{ name: "Œufs", canonical: "oeuf", qty: 3, unit: "unite" }],
      }),
    );
    expect(norm.ingredients[0]).toMatchObject({ qty: 3, unit: "unite", note: null });
    expect(norm.imageUrl).toBeNull();
  });

  it("une unité inconnue → « au goût » (jamais un poids inventé), pas un rejet", () => {
    const norm = normalizeParsedRecipe(
      RawParsedRecipeSchema.parse({
        ...valid,
        ingredients: [{ name: "Persil", canonical: "persil", qty: 1, unit: "poignée", note: null }],
      }),
    );
    expect(norm.ingredients[0]).toMatchObject({ qty: null, unit: null });
  });

  it("rejette encore une recette sans aucun ingrédient", () => {
    expect(() => RawParsedRecipeSchema.parse({ ...valid, ingredients: [] })).toThrow();
  });
});

describe("CostEstimateSchema (indexé) + alignCosts", () => {
  it("borne les coûts (0…500 $) et admet null (« je ne sais pas »)", () => {
    expect(CostEstimateSchema.parse({ items: [{ i: 0, estCost: null }] }).items).toHaveLength(1);
    expect(() => CostEstimateSchema.parse({ items: [{ i: 0, estCost: -1 }] })).toThrow();
  });

  it("réaligne les coûts par index sur la liste d'entrée (ordre du LLM sans importance)", () => {
    const parsed = CostEstimateSchema.parse({
      items: [
        { i: 2, estCost: 3 },
        { i: 0, estCost: 1.5 },
      ],
    });
    // index 1 absent de la réponse → null ; l'ordre renvoyé par le LLM n'a pas d'impact.
    expect(alignCosts(parsed, 3)).toEqual([1.5, null, 3]);
  });

  it("ignore un index hors borne (jamais de débordement)", () => {
    const parsed = CostEstimateSchema.parse({ items: [{ i: 9, estCost: 2 }] });
    expect(alignCosts(parsed, 2)).toEqual([null, null]);
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
