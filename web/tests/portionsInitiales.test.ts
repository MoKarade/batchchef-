import { describe, expect, it } from "vitest";
import { portionsInitiales } from "@/lib/portionsInitiales";

const recettes = [
  { id: 1, servings: 4 },
  { id: 2, servings: 6 },
];

describe("portionsInitiales", () => {
  it("coche la recette demandée avec ses portions de base", () => {
    expect(portionsInitiales(recettes, "2")).toEqual({ 2: 6 });
  });
  it("ignore une recette absente de la bibliothèque", () => {
    expect(portionsInitiales(recettes, "99")).toEqual({});
  });
  it("ignore une valeur absente ou mal formée", () => {
    expect(portionsInitiales(recettes, undefined)).toEqual({});
    expect(portionsInitiales(recettes, "abc")).toEqual({});
    expect(portionsInitiales(recettes, "1.5")).toEqual({});
    expect(portionsInitiales(recettes, "")).toEqual({});
  });
});
