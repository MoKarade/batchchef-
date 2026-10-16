// Liens de recherche par épicier (jalon B, tâche #193). Verrouille l'ordre d'affichage, l'hôte de chaque
// gabarit (aucun terme venu de la base ne peut le changer) et l'encodage du terme.

import { describe, expect, it } from "vitest";
import { EPICIER_PAR_DEFAUT, EPICIERS, lienRecherche } from "../lib/epiciers";

describe("EPICIERS — liste fermée, dans l'ordre de la spec", () => {
  it("est exactement cette liste (un ajout ou un déplacement silencieux doit rougir)", () => {
    expect(EPICIERS.map((e) => e.id)).toEqual(["maxi", "metro", "iga", "superc", "walmart"]);
    expect(EPICIERS.map((e) => e.nom)).toEqual(["Maxi", "Metro", "IGA", "Super C", "Walmart"]);
  });

  it("chaque gabarit est en https, sur un hôte fixe, avec un seul emplacement {q}", () => {
    const hotes = EPICIERS.map((e) => new URL(e.gabarit.replace("{q}", "x")).host);
    expect(hotes).toEqual(["www.maxi.ca", "www.metro.ca", "www.iga.net", "www.superc.ca", "www.walmart.ca"]);
    for (const e of EPICIERS) {
      expect(e.gabarit.startsWith("https://")).toBe(true);
      expect(e.gabarit.split("{q}")).toHaveLength(2);
    }
  });
});

describe("EPICIER_PAR_DEFAUT", () => {
  it("est le premier de la liste", () => {
    expect(EPICIERS[0]).toBe(EPICIER_PAR_DEFAUT);
  });
});

describe("lienRecherche", () => {
  const maxi = EPICIER_PAR_DEFAUT;

  it("encode le terme (accents, espaces)", () => {
    expect(lienRecherche(maxi, "Crème liquide")).toBe(
      "https://www.maxi.ca/fr/search?search-bar=Cr%C3%A8me%20liquide",
    );
  });

  it("ne laisse passer ni paramètre ni changement d'hôte", () => {
    for (const e of EPICIERS) {
      const terme = "x&q=evil#a/../b?c=d https://evil.com";
      const lien = lienRecherche(e, terme);
      expect(lien).not.toBeNull();
      const url = new URL(lien as string);
      const modele = new URL(e.gabarit.replace("{q}", "x"));
      expect(url.host).toBe(modele.host);
      expect(url.pathname).toBe(modele.pathname);
      expect(url.hash).toBe("");
      // Un seul paramètre, et sa valeur est le terme d'origine, intact.
      expect([...url.searchParams.keys()]).toEqual([...modele.searchParams.keys()]);
      expect([...url.searchParams.values()]).toEqual([terme]);
    }
  });

  it("replie les espaces multiples et refuse un terme vide", () => {
    expect(lienRecherche(maxi, "  poulet   rôti ")).toBe(
      "https://www.maxi.ca/fr/search?search-bar=poulet%20r%C3%B4ti",
    );
    expect(lienRecherche(maxi, "")).toBeNull();
    expect(lienRecherche(maxi, "   \n ")).toBeNull();
  });
});
