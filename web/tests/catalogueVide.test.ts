import { describe, expect, it } from "vitest";
import { messageCatalogueVide } from "@/lib/catalogueVide";

describe("messageCatalogueVide", () => {
  it("catalogue sans aucune recette : aucun jargon technique à l'écran", () => {
    const m = messageCatalogueVide({ total: 0, typeDemande: false });
    expect(m.titre).toBe("Catalogue vide");
    expect(m.texte).not.toMatch(/npm|import|lance/i);
  });
  it("recherche sans résultat avec un type : suggère « Non déterminé »", () => {
    const m = messageCatalogueVide({ total: 40, typeDemande: true });
    expect(m.titre).toBe("Aucun résultat");
    expect(m.texte).toContain("Non déterminé");
  });
  it("recherche sans résultat sans type", () => {
    const m = messageCatalogueVide({ total: 40, typeDemande: false });
    expect(m.texte).toBe("Aucun résultat pour cette recherche.");
  });
});
