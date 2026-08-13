// Navigation : quel onglet est allumé, et pour quelles URLs.
//
// Ça paraît cosmétique et ça ne l'est pas : un onglet qui ne s'allume jamais sur les pages
// de détail donne à l'app l'air d'être « nulle part », et c'est précisément là qu'on passe
// le plus de temps (une recette, un batch, une liste d'épicerie).

import { describe, expect, it } from "vitest";
import { ONGLETS, estOngletActif } from "../components/Navigation";

describe("estOngletActif", () => {
  it("allume l'onglet d'une SECTION, pas seulement son URL exacte", () => {
    expect(estOngletActif("/recettes", "/recettes")).toBe(true);
    expect(estOngletActif("/recettes", "/recettes/12")).toBe(true);
    expect(estOngletActif("/batchs", "/batchs/3")).toBe(true);
  });

  it("l'accueil ne s'allume QUE sur l'accueil", () => {
    // « / » est le préfixe de toutes les URLs : une comparaison par préfixe l'allumerait
    // partout, et deux onglets seraient actifs en même temps.
    expect(estOngletActif("/", "/")).toBe(true);
    expect(estOngletActif("/", "/recettes")).toBe(false);
    expect(estOngletActif("/", "/batchs/3")).toBe(false);
  });

  it("ne confond pas deux sections dont l'une préfixe l'autre", () => {
    // « /recettes » ne doit pas s'allumer sur une hypothétique « /recettes-archivees ».
    expect(estOngletActif("/recettes", "/recettes-archivees")).toBe(false);
  });

  it("au plus UN onglet actif à la fois, sur toutes les URLs de l'app", () => {
    const urls = [
      "/",
      "/recettes",
      "/recettes/12",
      "/batchs",
      "/batchs/nouveau",
      "/batchs/3",
      "/catalogue",
      "/catalogue/900",
      "/courses/3",
      "/partage",
    ];
    for (const url of urls) {
      const actifs = ONGLETS.filter((o) => estOngletActif(o.href, url));
      expect(actifs.length, `plusieurs onglets actifs sur ${url}`).toBeLessThanOrEqual(1);
    }
  });
});
