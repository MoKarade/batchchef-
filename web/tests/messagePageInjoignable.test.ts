import { describe, expect, it } from "vitest";
import { messagePageInjoignable } from "@/lib/actionsInternes/commun";

describe("messagePageInjoignable", () => {
  it("n'affiche jamais de code HTTP", () => {
    for (const s of [401, 403, 404, 410, 429, 500, 502, 503]) {
      expect(messagePageInjoignable(s)).not.toMatch(/HTTP|\d{3}/);
    }
  });

  it("dit que le site refuse d'être lu pour 401, 403 et 429", () => {
    for (const s of [401, 403, 429]) {
      expect(messagePageInjoignable(s)).toContain("refuse d’être lu");
    }
  });

  it("dit que la page n'existe plus pour 404 et 410", () => {
    for (const s of [404, 410]) {
      expect(messagePageInjoignable(s)).toContain("n’existe plus");
    }
  });

  it("donne une phrase générique pour les autres statuts", () => {
    expect(messagePageInjoignable(500)).toContain("n’a pas pu être lue");
  });
});
