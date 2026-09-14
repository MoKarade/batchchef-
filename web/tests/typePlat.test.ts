// Verrou du classement par type de plat (SEM-01).
//
// Ce que ce fichier protège en priorité : les cas qui ont RÉELLEMENT produit une erreur
// pendant la mise au point. Chacun porte le titre qui l'a révélé — un test écrit d'après un
// cas imaginé ne prouve pas grand-chose, un test écrit d'après un cas mesuré tient.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import initSqlJs from "sql.js";
import {
  FAMILLES,
  FAMILLES_REPAS,
  LIBELLES,
  classerRecette,
  comparable,
  estRepas,
  estTypePlat,
  typeEffectif,
} from "../lib/typePlat";

const r = (titre: string, ...ingredients: string[]) => classerRecette({ titre, ingredients });

describe("comparable — la forme sur laquelle tout repose", () => {
  it("retire accents, apostrophes et ponctuation, et borde d'espaces", () => {
    expect(comparable("Bœuf à l'ail, façon grand-mère")).toBe(" boeuf a l ail facon grand mere ");
  });

  it("ne dépend pas du type d'apostrophe", () => {
    // 340 noms d'ingrédient du corpus portent l'apostrophe TYPOGRAPHIQUE (leçon CAT-B).
    expect(comparable("Huile d’olive")).toBe(comparable("Huile d'olive"));
  });

  it("permet de chercher un MOT ENTIER par simple inclusion", () => {
    // ⚠️ C'est la raison du bordage : `\b` est ASCII en JavaScript, donc « é » n'est pas un
    // caractère de mot et la frontière n'existe pas là où on l'attend.
    const t = comparable("Poivrons farcis");
    expect(t.includes(" poivrons ")).toBe(true);
    expect(t.includes(" poivre ")).toBe(false);
  });
});

describe("le mot de famille doit NOMMER la recette, pas la qualifier", () => {
  it("« Sauce bolognaise » est une sauce", () => {
    expect(r("Sauce bolognaise", "tomates", "oignons").type).toBe("sauce");
  });

  it("« Porc sauce aigre douce » est un PLAT, pas une sauce", () => {
    // Mutation : porter TETE_MAX à 14 (sa valeur d'origine) fait échouer ce cas — mesuré.
    expect(r("Porc sauce aigre douce à ma façon", "porc", "oignons").type).toBe("plat");
  });

  it("« Pizza au pesto, courgette, oignon » est un plat, pas une sauce", () => {
    expect(r("Pizza au pesto, courgette, oignon", "mozzarella", "courgettes").type).toBe("plat");
  });

  it("un article devant le mot ne le disqualifie pas", () => {
    expect(r("La sauce tomate de mamie", "tomates", "oignons").type).toBe("sauce");
    expect(r("Ma soupe de courge", "courgettes", "bouillon").type).toBe("soupe");
  });

  it("mais un NOM devant, si — même court", () => {
    // ⚠️ C'est LA distinction que la borne en caractères ratait : « Porc sauce » et « Ma
    // sauce » commencent au même caractère. Seule la liste d'articles les sépare.
    expect(r("Porc sauce aigre douce", "porc", "oignons").type).toBe("plat");
    expect(r("Poulet rôti sauce vin rouge", "poulet", "thym").type).toBe("plat");
  });

  it("« bœuf » est reconnu malgré la ligature", () => {
    // NFD ne décompose pas « œ » : sans le remplacement explicite, « bœuf » devenait
    // « b uf » et perdait son marqueur salé, sur un corpus où le boeuf est partout.
    expect(comparable("Bœuf bourguignon")).toBe(" boeuf bourguignon ");
    expect(r("Mijoté de bœuf", "boeuf", "carottes").type).toBe("plat");
  });

  it("« Salade de gnocchis poêlés » est une SALADE, pas un plat de gnocchis", () => {
    // L'ordre des familles compte : les plus spécifiques passent avant « plat ».
    expect(r("Salade de gnocchis poêlés", "parmesan", "champignons de paris").type).toBe("salade");
  });
});

describe("les titres ambigus se tranchent par les INGRÉDIENTS", () => {
  it("« Tarte aux pommes » est un dessert, « Tarte au chèvre et lardons » un plat", () => {
    expect(r("Tarte aux pommes", "sucre", "pommes").type).toBe("dessert");
    expect(r("Tarte de blette au chèvre et aux lardons", "lardons", "oignons").type).toBe("plat");
  });

  it("« Flan de thon » est un plat, « Flan pâtissier » un dessert", () => {
    // Mesuré : « Flan de thon provençal » sortait en DESSERT tant que « flan » était rangé
    // dans la liste des desserts. Un mot qui sert des deux côtés n'appartient à personne.
    expect(r("Flan de thon provençal", "thon", "oignons").type).toBe("plat");
    expect(r("Flan pâtissier vanille", "sucre", "vanille").type).toBe("dessert");
  });

  it("rend « non déterminé » quand le titre est ambigu et les ingrédients muets", () => {
    const v = r("Tarte du dimanche", "farine", "beurre");
    expect(v.type).toBeNull();
    expect(v.voie).toBe("ambigu");
  });
});

describe("un camp SUCRÉ franc l'emporte sur une famille salée du titre", () => {
  it("« Frites de cookie » est un dessert, pas un accompagnement", () => {
    // Mutation : retirer la bascule rend « accompagnement » — mesuré.
    expect(r("Frites de cookie", "chocolat", "sucre").type).toBe("dessert");
  });

  it("« Verrines mascarpone, pommes, caramel » est un dessert, pas une entrée", () => {
    expect(r("Verrines mascarpone, pommes, caramel", "caramel", "sucre").type).toBe("dessert");
  });

  it("mais « Frites maison » reste un accompagnement", () => {
    expect(r("Frites maison au four", "pommes de terre", "huile d olive").type).toBe("accompagnement");
  });

  it("et un dessert nommé comme tel reste un dessert malgré des marqueurs salés", () => {
    // L'inverse n'est PAS symétrique : beurre, oeufs et même une pointe de sel sont des faux
    // amis dans une pâtisserie. Seul le sens sucré → dessert est appliqué.
    expect(r("Tiramisu aux fraises", "mascarpone", "persil").type).toBe("dessert");
  });
});

describe("ce qu'on ne sait pas, on le DIT", () => {
  it("aucun signal ⇒ null, avec la voie qui l'explique", () => {
    const v = r("Recette de mon grand-père", "farine", "eau");
    expect(v.type).toBeNull();
    expect(v.voie).toBe("aucun-signal");
  });

  it("ne rend jamais une famille hors de la liste fermée", () => {
    const v = r("Soupe à l'oignon", "oignons", "bouillon");
    expect(v.type !== null && (FAMILLES as readonly string[]).includes(v.type)).toBe(true);
  });

  it("chaque famille a un libellé, et aucun libellé n'est orphelin", () => {
    expect(Object.keys(LIBELLES).sort()).toEqual([...FAMILLES].sort());
  });
});

describe("estRepas et typeEffectif", () => {
  it("plat, soupe et salade font un repas ; dessert et sauce non", () => {
    expect(FAMILLES_REPAS.every(estRepas)).toBe(true);
    expect(estRepas("dessert")).toBe(false);
    expect(estRepas("sauce")).toBe(false);
    expect(estRepas("entree")).toBe(false);
    expect(estRepas(null)).toBe(false);
  });

  it("la correction de Marc l'emporte sur l'estimation", () => {
    expect(typeEffectif("dessert", { type: "plat" })).toEqual({ type: "plat", corrige: true });
  });

  it("une correction à NULL est une décision, pas une absence de correction", () => {
    // ⚠️ Marc peut vouloir dire « aucune de ces familles ». Les deux se distinguent par la
    // PRÉSENCE de la ligne, jamais par sa valeur — sinon sa décision serait silencieusement
    // remplacée par l'estimation au prochain build.
    expect(typeEffectif("dessert", { type: null })).toEqual({ type: null, corrige: true });
    expect(typeEffectif("dessert", null)).toEqual({ type: "dessert", corrige: false });
    expect(typeEffectif("dessert", undefined)).toEqual({ type: "dessert", corrige: false });
  });

  it("estTypePlat refuse tout ce qui n'est pas une famille connue", () => {
    expect(estTypePlat("plat")).toBe(true);
    expect(estTypePlat("gouter")).toBe(false);
    expect(estTypePlat(null)).toBe(false);
    expect(estTypePlat(3)).toBe(false);
  });
});

describe("le CORPUS ENTIER — la couverture, mesurée et non promise", () => {
  const require_ = createRequire(import.meta.url);

  it("classe au moins 88 % des 10 188 recettes, et chaque famille est peuplée", async () => {
    const SQL = await initSqlJs({ locateFile: () => require_.resolve("sql.js/dist/sql-wasm.wasm") });
    const seed = new SQL.Database(readFileSync(resolve(process.cwd(), "data", "batchchef.seed.db")));
    const ing = new Map<number, string[]>();
    const si = seed.prepare(
      `SELECT ri.recipe_id r, im.canonical_name n FROM recipe_ingredient ri
       JOIN ingredient_master im ON im.id = ri.ingredient_master_id`,
    );
    while (si.step()) {
      const x = si.getAsObject() as { r: number; n: string };
      const l = ing.get(x.r) ?? [];
      l.push(String(x.n).replace(/_/g, " "));
      ing.set(x.r, l);
    }
    si.free();
    const recettes: { titre: string; ingredients: string[] }[] = [];
    const sr = seed.prepare("SELECT id i, title t FROM recipe");
    while (sr.step()) {
      const x = sr.getAsObject() as { i: number; t: string };
      recettes.push({ titre: String(x.t), ingredients: ing.get(x.i) ?? [] });
    }
    sr.free();
    seed.close();

    expect(recettes.length).toBeGreaterThan(10_000); // anti-vacuité : le corpus est bien lu

    const par = new Map<string, number>();
    for (const rec of recettes) {
      const k = classerRecette(rec).type ?? "_null";
      par.set(k, (par.get(k) ?? 0) + 1);
    }
    const classees = recettes.length - (par.get("_null") ?? 0);
    // Mesuré le 14/09/2026 : 91,4 % (8,6 % non déterminé). Le plancher est posé EN DESSOUS
    // de la mesure pour ne pas rougir au premier ajustement de vocabulaire — ce qu'il
    // interdit, c'est un effondrement silencieux de la couverture.
    expect(classees / recettes.length).toBeGreaterThan(0.88);
    // ⚠️ Et une borne HAUTE : une couverture de 100 % voudrait dire qu'on a cessé d'avouer
    // ce qu'on ne sait pas, ce qui est exactement le défaut que « non déterminé » évite.
    expect(classees / recettes.length).toBeLessThan(0.98);

    // Aucune famille ne doit être vide : une case jamais remplie est une case en trop.
    for (const f of FAMILLES) expect(par.get(f) ?? 0, f).toBeGreaterThan(50);
  }, 120_000);
});
