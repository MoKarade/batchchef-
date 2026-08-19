// Lecture du texte source pour corriger noms ET unités (ING-04/ING-05).
//
// Le défaut vient d'une extraction d'unité SANS frontière de mot : `g` reconnu dans
// « gousses », `cl` dans « clous », `l` dans « lamelles ». Les cas ci-dessous sont relevés
// sur le corpus réel, pas inventés.

import { describe, expect, it } from "vitest";
import { analyserTexteSource, estUniteDeMesure, nomRestaure, uniteCorrigee } from "../lib/ingredientsSource";

describe("lecture du texte source", () => {
  it("reconnaît une VRAIE unité de masse ou de volume", () => {
    for (const [raw, mot] of [["320 g de fusilli", "g"], ["10 cl de crème", "cl"], ["1.5 kg de farine", "kg"], ["250 ml de lait", "ml"]] as const) {
      const r = analyserTexteSource(raw);
      expect(r.classe, raw).toBe("reelle");
      expect(r.mot, raw).toBe(mot);
    }
  });

  it("reconnaît un DÉNOMBRABLE que l'extraction V3 avait mordu", () => {
    for (const raw of ["1 gousses d'ail", "2 clous de girofle", "8 lamelles de poivron", "1 grosses pincées de sel", "3 gouttes de vanille"]) {
      expect(analyserTexteSource(raw).classe, raw).toBe("comptable");
    }
  });

  it("⚠️ NE mord PAS dans le mot — c'est tout le correctif", () => {
    // `g` ne doit pas matcher le début de « gousses », sinon on recrée le bug d'origine.
    expect(analyserTexteSource("1 gousses d'ail").mot).toBe("gousses");
    expect(analyserTexteSource("2 clous de girofle").mot).toBe("clous");
    expect(analyserTexteSource("1 gingembre").classe).toBe("aucune");
    expect(analyserTexteSource("2 glaçons").classe).toBe("comptable");
  });

  it("les unités les plus LONGUES gagnent", () => {
    expect(analyserTexteSource("500 grammes de sucre").mot).toBe("grammes");
    expect(analyserTexteSource("2 centilitres d'huile").mot).toBe("centilitres");
  });

  it("rend « aucune » quand le texte ne commence pas par une unité", () => {
    for (const raw of ["4 tortillas de blé", "2 blancs de poulet", "sel", "1 poulet entier"]) {
      expect(analyserTexteSource(raw).classe, raw).toBe("aucune");
    }
  });
});

describe("correction de l'unité", () => {
  it("corrige quand TOUTES les sources disent un dénombrable", () => {
    expect(uniteCorrigee("g", ["1 gousses d'ail", "2 gousses d'ail", "3 gousses d'ail"])).toBe("unite");
    expect(uniteCorrigee("ml", ["1 clous de girofle", "2 clous de girofle"])).toBe("unite");
  });

  it("⚠️ S'ABSTIENT dès qu'une source dit une VRAIE unité", () => {
    // Le cas qui coûterait cher : « 200 g de gingembre » ne doit jamais devenir 200 unités.
    expect(uniteCorrigee("g", ["1 gingembre", "200 g de gingembre"])).toBeNull();
    expect(uniteCorrigee("g", ["1 gousses d'ail", "50 g d'ail"])).toBeNull();
  });

  it("ne touche pas une unité qui n'est pas une mesure", () => {
    expect(uniteCorrigee("unite", ["1 gousses d'ail"])).toBeNull();
    expect(uniteCorrigee(null, ["1 gousses d'ail"])).toBeNull();
  });

  it("s'abstient sans source — on ne devine pas", () => {
    expect(uniteCorrigee("g", [])).toBeNull();
  });

  it("est idempotente : une fois corrigée, l'unité n'est plus candidate", () => {
    const src = ["1 gousses d'ail"];
    const une = uniteCorrigee("g", src);
    expect(une).toBe("unite");
    expect(uniteCorrigee(une, src)).toBeNull();
  });

  it("estUniteDeMesure ne reconnaît que g et ml", () => {
    expect(estUniteDeMesure("g")).toBe(true);
    expect(estUniteDeMesure("ml")).toBe(true);
    expect(estUniteDeMesure("unite")).toBe(false);
    expect(estUniteDeMesure(null)).toBe(false);
  });
});

describe("restauration du nom", () => {
  it("rend les lettres mangées, d'après la source", () => {
    expect(nomRestaure("Ousses D'Ail", ["1 gousses d'ail"])).toBe("Gousses D'Ail");
    expect(nomRestaure("Ous De Girofle", ["1 clous de girofle"])).toBe("Clous De Girofle");
    expect(nomRestaure("Amelles De Poivron", ["8 lamelles de poivron"])).toBe("Lamelles De Poivron");
    expect(nomRestaure("Mis De Citron", ["1 demis de citron"])).toBe("Demis De Citron");
  });

  it("laisse un nom SAIN intact — même si la source contient un mot plus long", () => {
    expect(nomRestaure("Persil", ["1 cuillères à soupe de persil"])).toBe("Persil");
    expect(nomRestaure("Gousses D'Ail", ["1 gousses d'ail"])).toBe("Gousses D'Ail");
    expect(nomRestaure("Fusilli", ["320 g de fusilli"])).toBe("Fusilli");
  });

  it("est IDEMPOTENTE — la passe peut être rejouée à chaque déploiement", () => {
    for (const [nom, src] of [["Ousses D'Ail", ["1 gousses d'ail"]], ["Ous De Girofle", ["1 clous de girofle"]]] as const) {
      const une = nomRestaure(nom, [...src]);
      expect(nomRestaure(une, [...src]), nom).toBe(une);
    }
  });

  it("⚠️ refuse de restaurer au-delà de trois lettres perdues", () => {
    // Au-delà, ce n'est plus une troncature : c'est un AUTRE mot, et on inventerait.
    expect(nomRestaure("Ail", ["1 portail"])).toBe("Ail");
    expect(nomRestaure("Ces", ["des morceaux"])).toBe("Ces");
  });

  it("laisse le nom intact quand la source ne contient rien de plus long", () => {
    expect(nomRestaure("Ousses D'Ail", ["1 ousses d'ail"])).toBe("Ousses D'Ail");
    expect(nomRestaure("Ousses D'Ail", [])).toBe("Ousses D'Ail");
  });

  it("ne modifie QUE le premier mot", () => {
    const r = nomRestaure("Ousses D'Ail En Lamelles", ["2 gousses d'ail en lamelles"]);
    expect(r).toBe("Gousses D'Ail En Lamelles");
    expect(r.endsWith("D'Ail En Lamelles")).toBe(true);
  });
});
