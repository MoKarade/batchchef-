// Rayons de la liste d'épicerie (critère C5 de la spec « commande d'épicerie », 30/09/2026).
//
// Aucune donnée réelle ne dit dans quel rayon est un ingrédient : dans le seed V3,
// `ingredient_master.category` est NULL partout. Le rayon est donc DÉRIVÉ du nom par une table
// de mots-clés fermée, en mot entier. Ces tests verrouillent la liste des rayons, le classement
// d'un jeu d'ingrédients RÉELS (les plus fréquents du catalogue), les pièges de sous-chaîne, et
// la couverture mesurée sur le catalogue entier.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { RAYONS, rayonDe } from "../lib/rayons";
import { reparerCanonique } from "../lib/ingredientsNoms";

describe("RAYONS — liste fermée et ordonnée", () => {
  it("est exactement cette liste, dans cet ordre (un ajout silencieux doit rougir)", () => {
    expect([...RAYONS]).toEqual([
      "Fruits et légumes",
      "Viandes et poissons",
      "Produits laitiers et œufs",
      "Boulangerie",
      "Épicerie",
      "Autres",
    ]);
  });
});

describe("rayonDe — ingrédients réels les plus fréquents du seed (relevé du 30/09/2026)", () => {
  // Canonicals tels que le seed les stocke (soulignés compris), classés à la main.
  const attendus: [string, string][] = [
    ["oeufs", "Produits laitiers et œufs"],
    ["farine", "Épicerie"],
    ["beurre", "Produits laitiers et œufs"],
    ["oignons", "Fruits et légumes"],
    ["lait", "Produits laitiers et œufs"],
    ["carottes", "Fruits et légumes"],
    ["crème_liquide", "Produits laitiers et œufs"],
    ["échalotes", "Fruits et légumes"],
    ["tomates", "Fruits et légumes"],
    ["citrons", "Fruits et légumes"],
    ["courgettes", "Fruits et légumes"],
    ["chocolat_noir", "Épicerie"],
    ["pommes_de_terre", "Fruits et légumes"],
    ["poivrons_rouges", "Fruits et légumes"],
    ["parmesan", "Produits laitiers et œufs"],
    ["boeuf", "Viandes et poissons"],
    ["lardons", "Viandes et poissons"],
    ["lait_de_coco", "Épicerie"],
    ["vin_blanc", "Épicerie"],
    ["huile_d'olive", "Épicerie"],
    ["sucre", "Épicerie"],
    ["blancs_de_poulet", "Viandes et poissons"],
    ["tranches_de_pain_de_mie", "Boulangerie"],
    ["pains_pour_hamburger", "Boulangerie"],
    ["pavés_de_saumon", "Viandes et poissons"],
    ["jaunes_d'oeuf", "Produits laitiers et œufs"],
    ["mascarpone", "Produits laitiers et œufs"],
    ["riz", "Épicerie"],
  ];
  for (const [canonical, rayon] of attendus) {
    it(`${canonical} → ${rayon}`, () => {
      expect(rayonDe(canonical, canonical)).toBe(rayon);
    });
  }
});

describe("rayonDe — pièges (mot entier, jamais sous-chaîne)", () => {
  it("« persil » n'est pas du sel, « poivron » n'est pas du poivre", () => {
    expect(rayonDe("persil", "Persil")).toBe("Fruits et légumes");
    expect(rayonDe("sel", "Sel")).toBe("Épicerie");
    expect(rayonDe("poivron", "Poivron")).toBe("Fruits et légumes");
    expect(rayonDe("poivre", "Poivre")).toBe("Épicerie");
  });

  it("« lait de coco » et « beurre d'arachide » sont de l'épicerie, pas des laitiers", () => {
    expect(rayonDe("lait de coco", "Lait de coco")).toBe("Épicerie");
    expect(rayonDe("beurre d'arachide", "Beurre d'arachide")).toBe("Épicerie");
    expect(rayonDe("chocolat_au_lait", "Chocolat au lait")).toBe("Épicerie");
  });

  it("« bouillon de bœuf » est de l'épicerie ; « bœuf » (ligature) est de la viande", () => {
    expect(rayonDe("cubes_de_bouillon_de_boeuf", "Cubes de bouillon de bœuf")).toBe("Épicerie");
    expect(rayonDe("bœuf haché", "Bœuf haché")).toBe("Viandes et poissons");
  });

  it("« eau de rose » est de l'épicerie ; l'eau seule n'est rangée nulle part (Autres)", () => {
    expect(rayonDe("eau de rose", "Eau de rose")).toBe("Épicerie");
    expect(rayonDe("eau", "Eau")).toBe("Autres");
  });

  it("« concentré de tomates » et « raisins secs » ne sont pas des produits frais", () => {
    expect(rayonDe("concentré_de_tomates", "Concentré de tomates")).toBe("Épicerie");
    expect(rayonDe("raisins_secs", "Raisins secs")).toBe("Épicerie");
    expect(rayonDe("gingembre_en_poudre", "Gingembre en poudre")).toBe("Épicerie");
  });

  it("« fruits de mer » est du poisson, pas des fruits", () => {
    expect(rayonDe("fruits de mer", "Fruits de mer")).toBe("Viandes et poissons");
  });

  it("la pâte feuilletée n'est pas rangée avec les pâtes alimentaires (on ne sait pas : Autres)", () => {
    expect(rayonDe("pâtes_feuilletées", "Pâtes feuilletées")).toBe("Autres");
    expect(rayonDe("pâtes", "Pâtes")).toBe("Épicerie");
  });

  it("formes de pâtes et herbes séchées vues sur une vraie recette (Fusilli à la crème, seed n° 1)", () => {
    expect(rayonDe("fusilli", "Fusilli")).toBe("Épicerie");
    expect(rayonDe("origan", "Origan")).toBe("Épicerie");
    expect(rayonDe("piment de cayenne", "Piment de Cayenne")).toBe("Épicerie");
    expect(rayonDe("piment", "Piment")).toBe("Fruits et légumes");
  });

  it("singulier et pluriel se rangent pareil", () => {
    expect(rayonDe("pomme de terre", "Pomme de terre")).toBe(rayonDe("pommes de terre", "Pommes de terre"));
    expect(rayonDe("choux-fleurs", "Choux-fleurs")).toBe("Fruits et légumes");
    expect(rayonDe("poireaux", "Poireaux")).toBe("Fruits et légumes");
  });

  it("canonical muet → le nom d'affichage décide", () => {
    expect(rayonDe("ingredient", "Carottes")).toBe("Fruits et légumes");
  });

  it("rien de reconnu, nom vide ou résidu (« es », « ingrédient ») → Autres, jamais d'exception", () => {
    expect(rayonDe("es", "es")).toBe("Autres");
    expect(rayonDe("ingredient", "ingrédient")).toBe("Autres");
    expect(rayonDe("", "")).toBe("Autres");
    expect(rayonDe("xyzzy", "Xyzzy")).toBe("Autres");
  });

  it("rend toujours un rayon de la liste", () => {
    for (const t of ["", " ", "???", "Épicerie", "lait", "123", "a".repeat(500)]) {
      expect(RAYONS).toContain(rayonDe(t, t));
    }
  });
});

describe("rayonDe — couverture mesurée sur le catalogue réel", () => {
  const require_ = createRequire(import.meta.url);

  it("range hors « Autres » au moins 95 % des 200 canonicals les plus fréquents", async () => {
    const SQL = await initSqlJs({ locateFile: () => require_.resolve("sql.js/dist/sql-wasm.wasm") });
    const seed = new SQL.Database(readFileSync(resolve(process.cwd(), "data", "batchchef.seed.db")));
    const res = seed.exec(
      `SELECT im.canonical_name n FROM recipe_ingredient ri
       JOIN ingredient_master im ON im.id = ri.ingredient_master_id
       GROUP BY n ORDER BY count(*) DESC LIMIT 200`,
    );
    seed.close();
    const canonicals = (res[0]?.values ?? []).map((v) => reparerCanonique(String(v[0]).toLowerCase()));
    expect(canonicals.length).toBe(200); // anti-vacuité : le catalogue est bien lu

    const ranges = canonicals.filter((c) => rayonDe(c, c) !== "Autres").length;
    // Mesuré le 30/09/2026 : 192 sur 200 (96 %). Restent dans « Autres » : eau (×2), pâtes
    // feuilletées et brisées, feuilles de brick, bouquets garnis, et deux résidus V3 (« es »,
    // « laçons »). Plancher posé juste sous la mesure (cliquet) : ce qu'il interdit, c'est un
    // effondrement silencieux du classement.
    expect(ranges / canonicals.length).toBeGreaterThanOrEqual(0.95);
    // Borne haute : l'eau, les résidus (« es ») et les pâtes à tarte restent « Autres ».
    expect(ranges).toBeLessThan(200);
  });
});
