// Normalisation des unités brutes Marmiton → g/ml/unite. Discriminants : conversions
// volumétriques (cl/dl/l/tasse), cuillères désambiguïsées par le texte, « pincée » et
// unités inconnues → « au goût » (jamais un poids inventé), qty ≤ 0 rejetée.

import { describe, expect, it } from "vitest";
import { noteQuantiteNonConvertie, normalizeQty } from "../lib/units";

describe("normalizeQty", () => {
  it("garde g/ml/unite tels quels", () => {
    expect(normalizeQty(80, "g")).toEqual({ qty: 80, unit: "g" });
    expect(normalizeQty(2, "unite")).toEqual({ qty: 2, unit: "unite" });
    expect(normalizeQty(250, "ml")).toEqual({ qty: 250, unit: "ml" });
  });
  it("convertit les masses et volumes vers g/ml", () => {
    expect(normalizeQty(1.5, "kg")).toEqual({ qty: 1500, unit: "g" });
    expect(normalizeQty(10, "cl")).toEqual({ qty: 100, unit: "ml" });
    expect(normalizeQty(2, "dl")).toEqual({ qty: 200, unit: "ml" });
    expect(normalizeQty(0.5, "l")).toEqual({ qty: 500, unit: "ml" });
    expect(normalizeQty(1, "tasse")).toEqual({ qty: 250, unit: "ml" });
  });
  it("désambiguïse les cuillères via le texte brut (thé=5ml, soupe=15ml)", () => {
    expect(normalizeQty(2, "cuillères", "2 cuillères à soupe d'huile")).toEqual({ qty: 30, unit: "ml" });
    expect(normalizeQty(1, "cuillères", "1 cuillère à thé de sel")).toEqual({ qty: 5, unit: "ml" });
    expect(normalizeQty(1, "cuillère", "1 cuillère à café")).toEqual({ qty: 5, unit: "ml" });
  });
  it("« pincée » et unité inconnue → au goût (jamais de poids inventé)", () => {
    expect(normalizeQty(1, "pincée")).toEqual({ qty: null, unit: null });
    expect(normalizeQty(3, "poignée")).toEqual({ qty: null, unit: null });
  });
  it("quantité absente ou ≤ 0 → au goût", () => {
    expect(normalizeQty(null, "g")).toEqual({ qty: null, unit: null });
    expect(normalizeQty(0, "g")).toEqual({ qty: null, unit: null });
    expect(normalizeQty(-5, "g")).toEqual({ qty: null, unit: null });
  });
});

describe("unités ANGLAISES (une partie des reels sont en anglais)", () => {
  it("convertit les masses impériales", () => {
    // Sans ces entrées, chacune de ces quantités tombait en null : la recette paraissait
    // extraite et la liste d'épicerie sortait SANS AUCUN CHIFFRE, sans erreur affichée.
    expect(normalizeQty(8, "oz")).toEqual({ qty: 226.8, unit: "g" });
    expect(normalizeQty(1, "lb")).toEqual({ qty: 453.59, unit: "g" });
    expect(normalizeQty(2, "pounds")).toEqual({ qty: 907.18, unit: "g" });
    // ⚠️ `stick` exige désormais le nom de l'ingrédient (19/08/2026). L'invariant protégé
    // par ce test — une plaque de BEURRE vaut 113 g — est intact ; ce qui a changé est le
    // DÉFAUT quand on ne sait pas de quoi il s'agit. Rendre 113 g pour un « stick » inconnu
    // revenait à inventer un poids, ce que le projet refuse partout ailleurs : un bâton de
    // cannelle valait 113 g de cannelle. Voir « stick : beurre ou bâton ? » plus bas.
    expect(normalizeQty(1, "stick", "stick", "beurre")).toEqual({ qty: 113, unit: "g" });
  });

  it("convertit les volumes anglais", () => {
    expect(normalizeQty(2, "cups")).toEqual({ qty: 500, unit: "ml" });
    expect(normalizeQty(1, "tbsp")).toEqual({ qty: 15, unit: "ml" });
    expect(normalizeQty(2, "tsp")).toEqual({ qty: 10, unit: "ml" });
    expect(normalizeQty(1, "fl oz")).toEqual({ qty: 29.57, unit: "ml" });
  });

  it("tolère la ponctuation des abréviations", () => {
    expect(normalizeQty(4, "oz.")).toEqual({ qty: 113.4, unit: "g" });
    expect(normalizeQty(1, "fl. oz.")).toEqual({ qty: 29.57, unit: "ml" });
    expect(normalizeQty(3, "  LBS  ")).toEqual({ qty: 1360.77, unit: "g" });
  });

  it("compte les pièces anglaises", () => {
    expect(normalizeQty(3, "cloves")).toEqual({ qty: 3, unit: "unite" });
    expect(normalizeQty(2, "slices")).toEqual({ qty: 2, unit: "unite" });
  });

  it("REFUSE d'inventer un poids pour un contenant sans taille fixe", () => {
    // Une « can » de tomates peut faire 200 ou 800 g. Un chiffre inventé entrerait dans la
    // liste d'épicerie sans que rien ne le signale : « au goût » est la seule réponse juste.
    for (const flou of ["can", "package", "bunch", "handful", "pinch", "dash"]) {
      expect(normalizeQty(1, flou)).toEqual({ qty: null, unit: null });
    }
  });

  it("n'a pas cassé la désambiguïsation des cuillères françaises", () => {
    // La branche des cuillères s'appuie sur le point de « c. à soupe » : le nettoyage des
    // points ajouté pour « fl. oz. » ne doit pas passer devant elle.
    expect(normalizeQty(1, "c. à soupe", "c. à soupe")).toEqual({ qty: 15, unit: "ml" });
    expect(normalizeQty(1, "c. à thé", "c. à thé")).toEqual({ qty: 5, unit: "ml" });
  });
});

// ── Symétrie FR/EN et dénombrables (ING-02, 19/08/2026) ────────────────────────────
//
// Mesuré avant correctif sur 50 unités réelles : 58 % des quantités tombaient en « au goût ».
// La cause n'était pas l'anglais mais le FRANÇAIS — les entrées anglaises avaient été
// ajoutées en bloc sans revoir leurs équivalents français.

describe("symétrie FR/EN", () => {
  const PAIRES: Array<[string, string]> = [
    ["gousses", "cloves"],
    ["tranches", "slices"],
    ["morceaux", "pieces"],
    ["livre", "lb"],
    ["once", "oz"],
    ["cuillère à soupe", "tbsp"],
  ];

  it("la même notion donne le même résultat dans les deux langues", () => {
    // Le garde qui compte : toute unité ajoutée dans une langue doit l'être dans l'autre,
    // sinon l'asymétrie se recreuse en silence — rien n'échoue, la quantité disparaît.
    for (const [fr, en] of PAIRES) {
      const a = normalizeQty(2, fr, fr);
      const b = normalizeQty(2, en, en);
      expect(a, `${fr} vs ${en}`).toEqual(b);
    }
  });
});

describe("dénombrables et calibres", () => {
  it("un dénombrable garde son compte au lieu de tomber en « au goût »", () => {
    for (const u of ["gousses", "tranches", "branches", "filets", "feuilles", "oeufs", "stalks", "sprigs", "fillets"]) {
      expect(normalizeQty(3, u, u), u).toEqual({ qty: 3, unit: "unite" });
    }
  });

  it("un CALIBRE est un adjectif de taille : la quantité reste le compte", () => {
    // « 3 large eggs » = 3 œufs. Traiter `large` comme une unité inconnue jetait le compte.
    for (const u of ["large", "medium", "small", "gros", "petite"]) {
      expect(normalizeQty(3, u, u), u).toEqual({ qty: 3, unit: "unite" });
    }
  });

  it("ce qui n'a VRAIMENT pas de taille fixe reste « au goût »", () => {
    // La frontière ne bouge pas : on n'invente toujours aucun poids.
    for (const u of ["pincée", "poignée", "botte", "sachet", "boîte", "can", "bunch", "dash", "splash"]) {
      expect(normalizeQty(2, u, u), u).toEqual({ qty: null, unit: null });
    }
  });
});

describe("« stick » : beurre ou bâton ?", () => {
  it("une plaque de BEURRE vaut 113 g", () => {
    expect(normalizeQty(2, "sticks", "sticks", "beurre non salé")).toEqual({ qty: 226, unit: "g" });
    expect(normalizeQty(1, "stick", "stick", "butter")).toEqual({ qty: 113, unit: "g" });
  });

  it("tout le reste compte des PIÈCES", () => {
    // « 1 cinnamon stick » valait 113 g de cannelle : absurde en cuisine, et le prix suivait.
    expect(normalizeQty(1, "stick", "stick", "cinnamon")).toEqual({ qty: 1, unit: "unite" });
    expect(normalizeQty(2, "sticks", "sticks", "céleri")).toEqual({ qty: 2, unit: "unite" });
  });

  it("le nom de l'ingrédient ne perturbe PAS les cuillères", () => {
    // `rawText` sert à distinguer « c. à thé » de « c. à soupe » : y fondre le nom ferait
    // de « 1 c. à soupe de café moulu » une cuillère à café.
    expect(normalizeQty(1, "c. à soupe", "c. à soupe", "café moulu")).toEqual({ qty: 15, unit: "ml" });
    expect(normalizeQty(1, "c. à thé", "c. à thé", "sucre")).toEqual({ qty: 5, unit: "ml" });
  });
});

describe("noteQuantiteNonConvertie", () => {
  it("garde ce que la source disait quand on n'a pas su convertir", () => {
    // Sans ça, « 2 cans » devient « au goût » et l'unité d'origine est perdue POUR
    // TOUJOURS : aucune table ne la stocke, donc élargir FACTORS plus tard ne rattrape
    // rien de ce qui est déjà en base.
    expect(noteQuantiteNonConvertie(null, 2, "cans")).toBe("2 cans");
    expect(noteQuantiteNonConvertie(null, 1, "botte")).toBe("1 botte");
  });

  it("complète une note existante sans l'écraser", () => {
    expect(noteQuantiteNonConvertie("bien mûre", 1, "poignée")).toBe("bien mûre · 1 poignée");
  });

  it("ne répète pas ce que la note dit déjà", () => {
    // « 2 cups · 2 cups » n'aide personne.
    expect(noteQuantiteNonConvertie("2 cups tassées", 2, "cups")).toBe("2 cups tassées");
  });

  it("se contente de l'unité quand la quantité manque", () => {
    expect(noteQuantiteNonConvertie(null, null, "pincée")).toBe("pincée");
  });

  it("rend null quand il n'y a vraiment rien à dire", () => {
    expect(noteQuantiteNonConvertie(null, null, null)).toBeNull();
    expect(noteQuantiteNonConvertie("  ", null, "  ")).toBeNull();
  });
});
