// Verrou de la SEULE suppression de toute l'app (CAT-E).
//
// Ce test protège d'abord ce qu'il ne faut PAS retirer : mon premier cadrage annonçait 40
// recettes à supprimer, et 22 d'entre elles étaient des recettes parfaitement normales.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import initSqlJs from "sql.js";
import { PLAFOND_RETRAITS, retraitsCatalogue, type RecetteCandidate } from "../lib/menageCatalogue";

const r = (url: string, titre: string, ingredients: string[], instructions = "Faire cuire."): RecetteCandidate => ({
  url,
  titre,
  instructions,
  ingredients,
});

describe("retraitsCatalogue — ce qu'on retire", () => {
  it("retire une recette sans ingrédient NI instructions", () => {
    const out = retraitsCatalogue([r("a", "Épaule de cochon", [], "")]);
    expect(out).toEqual([{ url: "a", motif: "vide" }]);
  });

  it("retire une recette sans ingrédient mais AVEC un texte, sous un motif distinct", () => {
    // Les deux cas partent, mais ils ne disent pas la même chose : l'un n'a jamais rien eu,
    // l'autre a perdu sa liste. Les confondre effacerait la trace du second.
    const out = retraitsCatalogue([r("a", "La recette du bonheur", [], "Un long texte.")]);
    expect(out).toEqual([{ url: "a", motif: "sansIngredient" }]);
  });

  it("retire UN exemplaire d'un groupe au même titre ET aux mêmes ingrédients", () => {
    const out = retraitsCatalogue([
      r("z-second", "Tartare de boeuf", ["500 g de boeuf", "1 oeufs"]),
      r("a-premier", "Tartare de boeuf", ["1 oeufs", "500 g de boeuf"]),
    ]);
    expect(out).toEqual([{ url: "z-second", motif: "doublon", garde: "a-premier" }]);
  });

  it("garde toujours le MÊME exemplaire, quel que soit l'ordre d'entrée", () => {
    // Mutation : trier sur autre chose que l'URL (l'ordre d'arrivée, par exemple) rend la
    // passe non déterministe — deux builds successifs supprimeraient des recettes
    // différentes, et la seconde suppression serait invisible.
    const a = r("a-premier", "X", ["1 oeufs"]);
    const b = r("z-second", "X", ["1 oeufs"]);
    expect(retraitsCatalogue([a, b])).toEqual(retraitsCatalogue([b, a]));
  });
});

describe("retraitsCatalogue — ce qu'on ne touche JAMAIS", () => {
  it("garde une recette à UN SEUL ingrédient", () => {
    // Mesuré : « Oeufs durs », « Purée d'amande », « Compote de nectarines », les cinq
    // confitures de lait déclinées par appareil. Ce sont des recettes, pas des coquilles.
    // Mutation : ajouter un critère « moins de deux ingrédients » en supprime 22 de vraies.
    expect(retraitsCatalogue([r("a", "Oeufs durs", ["4 oeufs"])])).toEqual([]);
  });

  it("garde deux recettes au même TITRE mais aux ingrédients différents", () => {
    // 72 des 87 titres partagés sont des variantes réelles — deux « sauce bolognaise » qui
    // ne se cuisinent pas pareil. Le titre est un indice, la liste d'ingrédients la preuve.
    // Mutation : grouper sur le titre seul supprime 72 recettes légitimes.
    const out = retraitsCatalogue([
      r("a", "Sauce bolognaise", ["500 g de boeuf", "1 oignons"]),
      r("b", "Sauce bolognaise", ["400 g de porc", "2 carottes", "1 celeri"]),
    ]);
    expect(out).toEqual([]);
  });

  it("ne groupe pas deux recettes vides entre elles", () => {
    // ⚠️ Le titre doit être le MÊME, sinon le test ne prouve rien : deux titres différents ne
    // se groupent jamais, et la mutation passait au vert. Mesuré — c'était le cas ici.
    // Sans l'exclusion préalable, leurs signatures d'ingrédients sont toutes deux vides, donc
    // la seconde ressort UNE SECONDE FOIS comme « doublon » : un motif faux, et un retrait
    // compté deux fois sur une décision irréversible.
    const out = retraitsCatalogue([r("a", "Même titre", [], ""), r("b", "Même titre", [], "")]);
    expect(out).toEqual([
      { url: "a", motif: "vide" },
      { url: "b", motif: "vide" },
    ]);
  });
});

describe("le CORPUS ENTIER — le compte exact, pas un ordre de grandeur", () => {
  const require_ = createRequire(import.meta.url);

  it("retire exactement 18 recettes sur 10 188, et chacune porte son motif", async () => {
    const SQL = await initSqlJs({ locateFile: () => require_.resolve("sql.js/dist/sql-wasm.wasm") });
    const seed = new SQL.Database(readFileSync(resolve(process.cwd(), "data", "batchchef.seed.db")));
    const ing = new Map<number, string[]>();
    const si = seed.prepare("SELECT recipe_id AS r, raw_text AS t FROM recipe_ingredient");
    while (si.step()) {
      const row = si.getAsObject() as { r: number; t: string | null };
      const l = ing.get(row.r) ?? [];
      l.push(String(row.t ?? ""));
      ing.set(row.r, l);
    }
    si.free();
    const candidates: RecetteCandidate[] = [];
    const sr = seed.prepare(
      "SELECT id AS i, title AS t, marmiton_url AS u, instructions AS n FROM recipe WHERE marmiton_url IS NOT NULL",
    );
    while (sr.step()) {
      const row = sr.getAsObject() as { i: number; t: string | null; u: string; n: string | null };
      candidates.push({
        url: row.u,
        titre: String(row.t ?? ""),
        instructions: String(row.n ?? ""),
        ingredients: ing.get(row.i) ?? [],
      });
    }
    sr.free();
    seed.close();

    const out = retraitsCatalogue(candidates);
    const parMotif = { vide: 0, sansIngredient: 0, doublon: 0 };
    for (const x of out) parMotif[x.motif] += 1;
    // Le corpus est FIGÉ (il est committé) : le compte est donc une valeur, pas une borne.
    // S'il bouge, c'est qu'une règle a changé — et une suppression ne se rattrape pas.
    expect(parMotif).toEqual({ vide: 1, sansIngredient: 2, doublon: 15 });
    expect(out.length).toBeLessThanOrEqual(PLAFOND_RETRAITS);
    // Aucun doublon ne se retire sans nommer l'exemplaire conservé.
    expect(out.filter((x) => x.motif === "doublon").every((x) => x.garde)).toBe(true);
    // Et jamais les deux exemplaires d'un même groupe.
    const gardes = new Set(out.map((x) => x.garde).filter(Boolean));
    expect(out.some((x) => gardes.has(x.url))).toBe(false);
  }, 60_000);
});
