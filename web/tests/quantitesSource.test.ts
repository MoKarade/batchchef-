// Verrou des QUANTITÉS reconstruites depuis le texte source (ING-08).
//
// Deux étages :
//   1. les règles, sur des cas nommés — chacune prouvée par mutation (cf. commentaires) ;
//   2. le CORPUS ENTIER (87 444 lignes du seed), audité par un invariant INDÉPENDANT des
//      règles : dans une recette, le rapport « nombre du texte / quantité par portion » doit
//      valoir le même rendement partout. C'est ce test-là qui a la valeur : les cas nommés
//      prouvent que le code fait ce que je crois, l'invariant prouve ce qu'il PRODUIT.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import initSqlJs from "sql.js";
import { nombreEnTete, quantiteCorrigee, rendementRecette } from "../lib/quantitesSource";
import { normalizeQty } from "../lib/units";

describe("nombreEnTete — ce que le texte annonce vraiment", () => {
  it("lit une fraction, un mixte, une décimale", () => {
    expect(nombreEnTete("1/2 kg de viande hachée")).toEqual({ valeur: 0.5, fraction: true });
    expect(nombreEnTete("3/4 de tasse de lait")).toEqual({ valeur: 0.75, fraction: true });
    expect(nombreEnTete("1 1/2 cuillères à soupe")).toEqual({ valeur: 1.5, fraction: true });
    expect(nombreEnTete("2,5 kg de moules")).toEqual({ valeur: 2.5, fraction: false });
    expect(nombreEnTete("~3 oeufs")).toEqual({ valeur: 3, fraction: false });
    expect(nombreEnTete("environ 200 g de farine")).toEqual({ valeur: 200, fraction: false });
  });

  it("un TIRET en tête est une puce de liste, pas un signe", () => {
    // Mutation : retirer `.replace(/^-\s*/, "")` rend -1 et fait de cette ligne un défaut
    // dans l'audit de corpus — 43 faux positifs mesurés avant correction.
    expect(nombreEnTete("-1 gousses d'ail")).toEqual({ valeur: 1, fraction: false });
    expect(nombreEnTete("- 250 g de beurre")).toEqual({ valeur: 250, fraction: false });
  });

  it("REFUSE de choisir dans une fourchette", () => {
    // Mutation : supprimer la garde « fourchette » fait lire 2 dans « 2 à 3 » et invente une
    // certitude que la source ne donne pas — c'est la porte ouverte aux fausses corrections.
    expect(nombreEnTete("2 à 3 cuillères à soupe d'huile")).toEqual({ valeur: null, fraction: false });
    expect(nombreEnTete("2-3 oignons")).toEqual({ valeur: null, fraction: false });
    expect(nombreEnTete("4 ou 5 tomates")).toEqual({ valeur: null, fraction: false });
  });

  it("rend null quand le texte ne commence par aucun nombre", () => {
    expect(nombreEnTete("huile")).toEqual({ valeur: null, fraction: false });
    expect(nombreEnTete("riz pour l'accompagnement")).toEqual({ valeur: null, fraction: false });
  });
});

describe("rendementRecette — le diviseur que la V3 a appliqué", () => {
  it("retrouve le rendement quand les lignes s'accordent", () => {
    expect(
      rendementRecette([
        { raw: "320 g de fusilli", qpp: 80 },
        { raw: "2 blancs de poulet", qpp: 0.5 },
        { raw: "8 champignons de Paris", qpp: 2 },
      ]),
    ).toBe(4);
  });

  it("tolère l'arrondi à quatre décimales de la V3 (1/6 = 0,1667)", () => {
    expect(rendementRecette([{ raw: "1 tomates", qpp: 0.1667 }, { raw: "6 oeufs", qpp: 1 }])).toBe(6);
  });

  it("refuse un diviseur qui n'est pas un rendement", () => {
    // Les 136 recettes dont la V3 a tout divisé par 500, 1 250 ou 10 000 : on ne peut pas
    // exprimer une quantité par portion, donc on n'en invente pas.
    expect(rendementRecette([{ raw: "200 g de thon", qpp: 0.019 }, { raw: "120 g de crème", qpp: 0.0114 }])).toBeNull();
  });

  it("refuse quand aucune majorité ne se dégage", () => {
    // Mutation : abaisser MAJORITE à 0 fait élire un rendement sur une seule ligne, et une
    // recette incohérente se met à « corriger » ses lignes saines vers un diviseur minoritaire.
    expect(
      rendementRecette([
        { raw: "4 oeufs", qpp: 1 },
        { raw: "200 g de farine", qpp: 33.3333 },
        { raw: "3 pommes", qpp: 0.375 },
      ]),
    ).toBeNull();
  });
});

describe("quantiteCorrigee — on ne corrige que ce qu'on sait expliquer", () => {
  it("une fraction lue « 1 » est ramenée à sa vraie valeur", () => {
    expect(quantiteCorrigee({ raw: "1/2 kg de viande hachée", qpp: 0.25 }, 4)).toEqual({
      corriger: true, qpp: 0.125, motif: "fraction",
    });
  });

  it("une fraction que la V3 a lue JUSTE n'est pas touchée", () => {
    // Mutation : retirer la condition `proche(qpp * rendement, 1)` corrige des lignes déjà
    // bonnes et les divise une seconde fois.
    expect(quantiteCorrigee({ raw: "1/2 kg de viande hachée", qpp: 0.125 }, 4)).toEqual({ corriger: false });
  });

  it("un texte sans nombre perd sa quantité, avec ou sans rendement", () => {
    expect(quantiteCorrigee({ raw: "huile", qpp: 0.25 }, 4)).toEqual({
      corriger: true, qpp: null, motif: "sansNombre",
    });
    expect(quantiteCorrigee({ raw: "riz pour l'accompagnement", qpp: 0.25 }, null)).toEqual({
      corriger: true, qpp: null, motif: "sansNombre",
    });
  });

  it("une PIÈCE sous-entendue vaut une pièce, pas « au goût »", () => {
    // « branche de persil » se lit « UNE branche ». Mutation : vider PIECE_IMPLICITE fait
    // tomber 572 lignes en « au goût » et perd un compte que n'importe qui lit d'un coup d'œil.
    expect(quantiteCorrigee({ raw: "branche de persil", qpp: 0.25 }, 4)).toEqual({ corriger: false });
    expect(quantiteCorrigee({ raw: "feuille de menthe", qpp: 1 }, 4)).toEqual({
      corriger: true, qpp: 0.25, motif: "sansNombre",
    });
  });

  it("la sentinelle 0,0001 est remplacée par ce que dit la source", () => {
    expect(quantiteCorrigee({ raw: "3 faisan", qpp: 0.0001 }, 4)).toEqual({
      corriger: true, qpp: 0.75, motif: "sentinelle",
    });
  });

  it("un rendement irrécupérable rend « au goût », jamais un chiffre gardé au hasard", () => {
    // Mutation : renvoyer { corriger: false } ici laisse « 200 g de thon » s'afficher
    // « 0,02 g » — un chiffre faux à chaque affichage, que rien ne signale.
    expect(quantiteCorrigee({ raw: "200 g de thon", qpp: 0.019 }, null)).toEqual({
      corriger: true, qpp: null, motif: "rendementInconnu",
    });
  });

  it("un écart INEXPLIQUÉ n'est pas corrigé", () => {
    // « 2.5 kg de moules » avec un rendement de 8 implique un rapport de 4 : l'un des deux
    // chiffres est faux et rien ne dit lequel. On s'abstient — une correction au jugé sur ce
    // qui décide de ce que Marc achète serait pire que le défaut.
    expect(quantiteCorrigee({ raw: "2.5 kg de moules", qpp: 0.625 }, 8)).toEqual({ corriger: false });
  });
});

describe("le CORPUS ENTIER — invariant indépendant des règles", () => {
  const require_ = createRequire(import.meta.url);

  it("après correction, chaque ligne s'accorde avec son texte source", async () => {
    const SQL = await initSqlJs({ locateFile: () => require_.resolve("sql.js/dist/sql-wasm.wasm") });
    const seed = new SQL.Database(readFileSync(resolve(process.cwd(), "data", "batchchef.seed.db")));
    const stmt = seed.prepare(
      `SELECT ri.recipe_id AS r, ri.raw_text AS raw, ri.quantity_per_portion AS q, ri.unit AS u,
              COALESCE(im.display_name_fr, ri.raw_text) AS nom
       FROM recipe_ingredient ri LEFT JOIN ingredient_master im ON im.id = ri.ingredient_master_id`,
    );
    const parRecette = new Map<number, Array<{ raw: string; qpp: number | null; u: string | null; nom: string }>>();
    while (stmt.step()) {
      const row = stmt.getAsObject() as { r: number; raw: string | null; q: number | null; u: string | null; nom: string | null };
      const l = parRecette.get(row.r) ?? [];
      l.push({ raw: String(row.raw ?? ""), qpp: row.q, u: row.u, nom: String(row.nom ?? "") });
      parRecette.set(row.r, l);
    }
    stmt.free();
    seed.close();

    let lignes = 0;
    const defauts: string[] = [];
    for (const [, liste] of parRecette) {
      const rendement = rendementRecette(liste.map((x) => ({ raw: x.raw, qpp: x.qpp })));
      for (const x of liste) {
        lignes += 1;
        const v = quantiteCorrigee({ raw: x.raw, qpp: x.qpp }, rendement);
        const qpp = v.corriger ? v.qpp : x.qpp;
        const finale = normalizeQty(qpp, x.u, x.raw, x.nom).qty;
        const { valeur } = nombreEnTete(x.raw);

        if (finale === null) continue; // « au goût » n'affirme rien : jamais un défaut.
        if (rendement === null) { defauts.push(`rendement perdu mais chiffre gardé : ${x.raw}`); continue; }
        if (valeur === null) {
          const piece = qpp !== null && Math.abs(qpp - 1 / rendement) <= 1e-6 + 0.01 / rendement;
          if (!piece) defauts.push(`aucun nombre en source mais quantité gardée : ${x.raw}`);
          continue;
        }
        if (qpp === null || qpp <= 0) { defauts.push(`nombre en source mais quantité perdue : ${x.raw}`); continue; }
        const rapport = valeur / qpp;
        if (Math.abs(rapport - rendement) > 0.02 * rendement) defauts.push(`rapport ${rapport.toFixed(2)} ≠ rendement ${rendement} : ${x.raw}`);
      }
    }

    expect(lignes).toBeGreaterThan(87_000);
    // Les QUATRE lignes irréductibles, nommées une par une. Le corpus étant figé (il est
    // committé), un seuil chiffré serait un plafond mou : on liste les cas, et toute
    // nouvelle famille de défaut fait échouer le test avec son texte source à l'écran.
    expect(defauts.sort()).toEqual([
      "rapport 4.00 ≠ rendement 2 : 12 cl d'huile",
      "rapport 4.00 ≠ rendement 2 : 2.5 kg de moules",
      "rapport 803.84 ≠ rendement 6 : -134 oeufs",
      "rapport 18400.00 ≠ rendement 4 : -4600 g de pomme de terre",
    ].sort());
  }, 60_000);
});
