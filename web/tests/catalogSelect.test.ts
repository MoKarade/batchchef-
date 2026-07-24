// Ajout massif depuis le catalogue : la séparation nouveau / déjà-présent est correcte
// (idempotence sur la source, jamais de doublon).

import { describe, expect, it } from "vitest";
import { splitNewCatalogRecipes } from "../lib/catalogSelect";

describe("splitNewCatalogRecipes", () => {
  const picks = [
    { id: 1, sourceUrl: "https://marmiton.org/a" },
    { id: 2, sourceUrl: "https://marmiton.org/b" },
    { id: 3, sourceUrl: "https://marmiton.org/c" },
  ];

  it("ignore les recettes déjà dans la bibliothèque (même sourceUrl)", () => {
    const { toAdd, skipped } = splitNewCatalogRecipes(picks, ["https://marmiton.org/b"]);
    expect(toAdd.map((p) => p.id)).toEqual([1, 3]);
    expect(skipped).toBe(1);
  });

  it("dédoublonne aussi au sein de la sélection (deux fois la même source)", () => {
    const dup = [
      { id: 10, sourceUrl: "https://x.org/1" },
      { id: 11, sourceUrl: "https://x.org/1" },
    ];
    const { toAdd, skipped } = splitNewCatalogRecipes(dup, []);
    expect(toAdd.map((p) => p.id)).toEqual([10]);
    expect(skipped).toBe(1);
  });

  it("ajoute toujours une recette sans sourceUrl (rien à comparer)", () => {
    const { toAdd, skipped } = splitNewCatalogRecipes(
      [{ id: 5, sourceUrl: null }],
      ["https://marmiton.org/a"],
    );
    expect(toAdd.map((p) => p.id)).toEqual([5]);
    expect(skipped).toBe(0);
  });

  it("tolère les espaces autour des URLs (trim des deux côtés)", () => {
    const { toAdd, skipped } = splitNewCatalogRecipes(
      [{ id: 7, sourceUrl: "  https://y.org/z  " }],
      ["https://y.org/z"],
    );
    expect(toAdd).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("tout nouveau → rien ignoré", () => {
    const { toAdd, skipped } = splitNewCatalogRecipes(picks, []);
    expect(toAdd).toHaveLength(3);
    expect(skipped).toBe(0);
  });
});
