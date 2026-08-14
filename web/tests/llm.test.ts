// Schémas LLM : un JSON hors contrat est REJETÉ (jamais un état sale en base),
// et htmlToText nettoie sans perdre les URLs d'images candidates.

import { describe, expect, it } from "vitest";
import {
  CostEstimateSchema,
  RawParsedRecipeSchema,
  alignCosts,
  analyserSortieRecette,
  aplatirNombre,
  aplatirTexte,
  htmlToText,
  normalizeParsedRecipe,
} from "../lib/llm";

/** Recette minimale valide — base des cas ci-dessous. */
const RECETTE_OK = {
  title: "Poulet au beurre",
  servings: 4,
  imageUrl: null,
  instructions: "Cuire.",
  ingredients: [{ name: "Poulet", canonical: "poulet", qty: 500, unit: "g", note: null }],
};

describe("tolérance aux variations de FORME du modèle", () => {
  it("des instructions rendues en LISTE deviennent un texte", () => {
    // Vécu le 13/08/2026 : demandées « une par ligne », elles sont revenues en tableau et
    // Zod a rejeté toute la recette APRÈS un appel vision déjà payé.
    const r = analyserSortieRecette({
      ...RECETTE_OK,
      instructions: ["1. Faire revenir.", "2. Mijoter 20 min."],
    });
    expect(r.instructions).toBe("1. Faire revenir.\n2. Mijoter 20 min.");
  });

  it("des étapes rendues en OBJETS sont lues sous leurs clés usuelles", () => {
    expect(aplatirTexte([{ text: "Couper" }, { etape: "Cuire" }])).toBe("Couper\nCuire");
  });

  it("un élément NON réductible laisse la valeur d'origine — le schéma refuse alors", () => {
    // Fabriquer « [object Object] » serait pire que l'erreur : ce serait une fausse étape
    // de recette, affichée comme si le modèle l'avait dite.
    const bancal = [{ inconnu: 12 }];
    expect(aplatirTexte(bancal)).toBe(bancal);
    expect(() => analyserSortieRecette({ ...RECETTE_OK, instructions: bancal })).toThrow();
  });

  it("laisse intact ce qui n'est pas une liste", () => {
    expect(aplatirTexte("Cuire.")).toBe("Cuire.");
    expect(aplatirTexte(null)).toBe(null);
    expect(aplatirTexte(undefined)).toBe(undefined);
  });

  it("un nombre rendu en chaîne redevient un nombre, virgule comprise", () => {
    expect(aplatirNombre("4")).toBe(4);
    expect(aplatirNombre("2,5")).toBe(2.5);
    expect(aplatirNombre("2.5")).toBe(2.5);
    expect(analyserSortieRecette({ ...RECETTE_OK, servings: "6" }).servings).toBe(6);
  });

  it("ne DEVINE pas un nombre approximatif — il doit être refusé", () => {
    // `servings` met à l'échelle toutes les quantités de la liste d'épicerie : convertir
    // « environ 4 » en 4 fabriquerait une donnée que la source n'a jamais annoncée.
    expect(aplatirNombre("environ 4")).toBe("environ 4");
    expect(aplatirNombre("1/2")).toBe("1/2");
    expect(() => analyserSortieRecette({ ...RECETTE_OK, servings: "environ 4" })).toThrow();
  });
});

describe("analyserSortieRecette : un refus NOMME le champ fautif", () => {
  it("dit quel champ cloche, pas seulement ce qui était attendu", () => {
    // « Expected string, received array » sans le chemin ne permet ni de corriger ni même
    // de savoir quoi soupçonner — un aller-retour entier perdu le 13/08.
    let message = "";
    try {
      analyserSortieRecette({ ...RECETTE_OK, title: ["Poulet"] });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("title");
    expect(message).toContain("hors schéma");
  });

  it("situe aussi un champ IMBRIQUÉ, avec son index", () => {
    let message = "";
    try {
      analyserSortieRecette({
        ...RECETTE_OK,
        ingredients: [{ name: "Poulet", qty: 500 }, { name: 42 }],
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("ingredients.1.name");
  });
});

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

  it("signale un nombre de portions DEVINÉ (une vidéo n'annonce presque jamais « pour 4 »)", () => {
    // servings absent → 4 par défaut, mais le drapeau dit que ce 4 n'est pas une donnée.
    const devine = normalizeParsedRecipe(
      RawParsedRecipeSchema.parse({ ...valid, servings: null }),
    );
    expect(devine).toMatchObject({ servings: 4, servingsGuessed: true });

    // servings annoncé → aucun avertissement à afficher.
    const annonce = normalizeParsedRecipe(RawParsedRecipeSchema.parse({ ...valid, servings: 6 }));
    expect(annonce).toMatchObject({ servings: 6, servingsGuessed: false });
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
