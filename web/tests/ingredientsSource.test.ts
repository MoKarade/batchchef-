// Lecture du texte source pour corriger noms ET unités (ING-04/ING-05).
//
// Le défaut vient d'une extraction d'unité SANS frontière de mot : `g` reconnu dans
// « gousses », `cl` dans « clous », `l` dans « lamelles ». Les cas ci-dessous sont relevés
// sur le corpus réel, pas inventés.

import { describe, expect, it } from "vitest";
import { analyserTexteSource, estUniteDeMesure, nomRestaure, nomSansPrepositionFinale, uniteCorrigee } from "../lib/ingredientsSource";

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

describe("quantités que le corpus contient vraiment", () => {
  it("⚠️ retire une quantité NÉGATIVE — sinon l'ail échappe au correctif", () => {
    // Vécu : « -1 gousses d'ail » existe dans le corpus. Sans le signe, la quantité n'était
    // pas retirée, aucune unité n'était reconnue, et la clé de l'ail entrait en désaccord
    // avec elle-même — donc se faisait écarter. 1 482 lignes passaient à travers.
    expect(analyserTexteSource("-1 gousses d'ail").classe).toBe("comptable");
    expect(analyserTexteSource("-1 gousses d'ail").mot).toBe("gousses");
  });

  it("tolère une approximation en tête", () => {
    expect(analyserTexteSource("~2 gousses d'ail").classe).toBe("comptable");
    expect(analyserTexteSource("environ 3 clous de girofle").classe).toBe("comptable");
  });

  it("les deux graphies de l'ail s'accordent désormais sur l'unité", () => {
    // C'est CE désaccord qui a fait échouer la première livraison.
    expect(uniteCorrigee("g", ["1 gousses d'ail"])).toBe("unite");
    expect(uniteCorrigee("g", ["-1 gousses d'ail"])).toBe("unite");
  });

  it("une fraction et un intervalle restent lus", () => {
    expect(analyserTexteSource("1/2 gousses d'ail").classe).toBe("comptable");
    expect(analyserTexteSource("2 à 3 gousses d'ail").classe).toBe("comptable");
  });
});

describe("restauration : où chercher le mot d'origine", () => {
  it("cherche D'ABORD dans l'ingrédient, pas dans l'unité", () => {
    // « 1/2 tasses de fraises » : le premier mot en `-es` du texte est « tasses », l'UNITÉ.
    // Restaurer « Es » en « Tasses » créait un désaccord avec la bonne restauration venue
    // d'une autre source, et le désaccord annulait les deux : 198 lignes abîmées à cause
    // d'une seule mal lue.
    expect(nomRestaure("Es", ["1/2 tasses de fraises"])).toBe("Fraises");
    expect(nomRestaure("Es", ["510 g de fraises"])).toBe("Fraises");
  });

  it("retombe sur le texte ENTIER quand le mot amputé EST l'unité", () => {
    // Ne chercher que dans la partie ingrédient perdait 595 restaurations qui marchaient.
    expect(nomRestaure("Rosses Pincées De Bicarbonate", ["1 grosses pincées de bicarbonate"]))
      .toBe("Grosses Pincées De Bicarbonate");
    expect(nomRestaure("Amelles De Poivron", ["8 lamelles de poivron"])).toBe("Lamelles De Poivron");
    expect(nomRestaure("Raines De Sésame", ["graines de sésame"])).toBe("Graines De Sésame");
  });

  it("saute PLUSIEURS mots d'unité enchaînés", () => {
    expect(nomRestaure("Es", ["1 grandes cuillères de fraises"])).toBe("Fraises");
  });

  it("⚠️ un fragment de TROIS lettres garde le budget serré", () => {
    // « Ail » est un vrai mot français : le transformer en « Portail » serait pire que de
    // ne rien faire. Seuls les fragments de deux lettres, qui ne sont jamais des mots,
    // ouvrent le budget large.
    expect(nomRestaure("Ail", ["1 portail"])).toBe("Ail");
    expect(nomRestaure("Riz", ["3 tasses de riz"])).toBe("Riz");
    expect(nomRestaure("Sel", ["1 pincées de sel"])).toBe("Sel");
  });
});

describe("préposition orpheline en fin de nom", () => {
  it("retire une préposition qui ne désigne rien", () => {
    expect(nomSansPrepositionFinale("Huile végétale pure à")).toBe("Huile végétale pure");
    expect(nomSansPrepositionFinale("Golden curry mélange pour")).toBe("Golden curry mélange");
    expect(nomSansPrepositionFinale("Tortillas nature, paquet de")).toBe("Tortillas nature, paquet");
  });

  it("⚠️ ne mord PAS dans un mot qui finit par les mêmes lettres", () => {
    // `\b` de JS ne traite pas « è » comme une lettre : /\bde$/ matche la fin de « Tiède »
    // et amputerait un nom parfaitement correct. Faux positif mesuré sur le corpus.
    expect(nomSansPrepositionFinale("Eau Tiède")).toBe("Eau Tiède");
    expect(nomSansPrepositionFinale("Bols D'Eau Tiède")).toBe("Bols D'Eau Tiède");
    expect(nomSansPrepositionFinale("Salade")).toBe("Salade");
    expect(nomSansPrepositionFinale("Crème Brûlée")).toBe("Crème Brûlée");
  });

  it("ne vide jamais un nom, et laisse un mot seul tranquille", () => {
    expect(nomSansPrepositionFinale("De")).toBe("De");
    expect(nomSansPrepositionFinale("à")).toBe("à");
    expect(nomSansPrepositionFinale("Persil")).toBe("Persil");
  });

  it("est idempotente", () => {
    const une = nomSansPrepositionFinale("Huile végétale pure à");
    expect(nomSansPrepositionFinale(une)).toBe(une);
  });
});
