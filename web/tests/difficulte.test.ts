// Verrou de la difficulté estimée (SEM-05).
//
// Ce que ce fichier protège en priorité : que l'échelle DISCRIMINE vraiment. Cinq niveaux
// dont trois sont vides seraient de la précision affichée qui n'existe pas dans la mesure —
// c'est le risque annoncé à Marc avant d'écrire une ligne, donc c'est ce qui est testé.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import initSqlJs from "sql.js";
import {
  ETOILES_MAX,
  LIBELLES_DIFFICULTE,
  SIGNAUX_MINIMUM,
  compterEtapes,
  estDifficulte,
  estimerDifficulte,
} from "../lib/difficulte";

const d = (ingredients: number, etapes: number, dureeMinutes: number) =>
  estimerDifficulte({ ingredients, etapes, dureeMinutes });

describe("compterEtapes — ce qui est une étape et ce qui n'en est pas", () => {
  it("compte les lignes non vides", () => {
    expect(compterEtapes("Mélanger.\nCuire 20 min.\nServir.")).toBe(3);
  });

  it("ignore les lignes trop courtes pour être une consigne", () => {
    // Un numéro orphelin ou une puce survit au nettoyage du texte (CAT-D) et gonflerait
    // le compte d'étapes — donc la difficulté — sans qu'aucune consigne existe.
    expect(compterEtapes("1.\nMélanger les oeufs et le sucre.\n-\nCuire.")).toBe(2);
  });

  it("une absence d'instructions vaut ZÉRO étape, pas une étape vide", () => {
    expect(compterEtapes(null)).toBe(0);
    expect(compterEtapes("")).toBe(0);
    expect(compterEtapes("   \n \n ")).toBe(0);
  });
});

describe("un signal ABSENT est retiré, jamais compté comme zéro", () => {
  it("deux signaux suffisent", () => {
    const v = d(8, 7, 0);
    expect(v.signaux).toBe(2);
    expect(v.etoiles).not.toBeNull();
  });

  it("un seul signal ne donne AUCUNE note", () => {
    const v = d(8, 0, 0);
    expect(v.signaux).toBe(1);
    expect(v.etoiles).toBeNull();
  });

  it("aucun signal ne donne aucune note", () => {
    expect(d(0, 0, 0)).toEqual({ etoiles: null, signaux: 0 });
  });

  it("⚠️ une durée absente ne rend pas la recette PLUS SIMPLE", () => {
    // Le piège : compter le signal manquant comme 0 minute ferait tomber la moyenne et
    // afficherait « très simple » pour une recette dont on ignore la durée. Un manque
    // déguisé en mesure, exactement ce que `null` existe pour éviter.
    const avec = d(13, 12, 80); // longue, bien renseignée
    const sans = d(13, 12, 0); // même recette, durée inconnue
    expect(avec.etoiles).not.toBeNull();
    expect(sans.etoiles).not.toBeNull();
    expect(sans.etoiles).toBe(avec.etoiles);
  });
});

describe("l'échelle est monotone et bornée", () => {
  it("une recette au plancher de chaque signal vaut UNE étoile", () => {
    expect(d(1, 1, 1).etoiles).toBe(1);
  });

  it("une recette au plafond de chaque signal vaut CINQ étoiles", () => {
    expect(d(41, 49, 4200).etoiles).toBe(ETOILES_MAX);
  });

  it("au-delà du plafond mesuré, la note reste bornée à cinq", () => {
    // Une valeur aberrante (une marinade de 3 jours) ne doit pas sortir de l'échelle.
    expect(d(200, 300, 100_000).etoiles).toBe(ETOILES_MAX);
  });

  it("ajouter des étapes ne peut jamais FAIRE BAISSER la note", () => {
    let precedent = 0;
    for (const etapes of [1, 3, 5, 7, 9, 12, 20, 49]) {
      const v = d(8, etapes, 40).etoiles ?? 0;
      expect(v, `à ${etapes} étapes`).toBeGreaterThanOrEqual(precedent);
      precedent = v;
    }
    expect(precedent).toBeGreaterThan(1); // anti-vacuité : la note a bien bougé
  });
});

describe("estDifficulte — ce qui revient de la base", () => {
  it("accepte 1 à 5, refuse le reste", () => {
    for (let i = 1; i <= ETOILES_MAX; i++) expect(estDifficulte(i)).toBe(true);
    for (const v of [0, 6, 2.5, "3", null, undefined, {}]) expect(estDifficulte(v)).toBe(false);
  });

  it("chaque niveau porte un libellé", () => {
    for (let i = 1; i <= ETOILES_MAX; i++) {
      expect(LIBELLES_DIFFICULTE[i as 1 | 2 | 3 | 4 | 5]).toBeTruthy();
    }
  });
});

describe("le CORPUS ENTIER — les cinq niveaux existent vraiment", () => {
  const require_ = createRequire(import.meta.url);

  it("note ≥ 99 % des recettes et peuple les cinq niveaux", async () => {
    const SQL = await initSqlJs({ locateFile: () => require_.resolve("sql.js/dist/sql-wasm.wasm") });
    const seed = new SQL.Database(readFileSync(resolve(process.cwd(), "data", "batchchef.seed.db")));

    const ing = new Map<number, number>();
    const si = seed.prepare("SELECT recipe_id r, COUNT(*) n FROM recipe_ingredient GROUP BY recipe_id");
    while (si.step()) {
      const x = si.getAsObject() as { r: number; n: number };
      ing.set(Number(x.r), Number(x.n));
    }
    si.free();

    const recettes: { ingredients: number; etapes: number; dureeMinutes: number }[] = [];
    const sr = seed.prepare("SELECT id i, instructions ins, prep_time_min p, cook_time_min c FROM recipe");
    while (sr.step()) {
      const x = sr.getAsObject() as { i: number; ins: string | null; p: number | null; c: number | null };
      recettes.push({
        ingredients: ing.get(Number(x.i)) ?? 0,
        etapes: compterEtapes(x.ins),
        dureeMinutes: (Number(x.p) || 0) + (Number(x.c) || 0),
      });
    }
    sr.free();
    seed.close();

    expect(recettes.length).toBeGreaterThan(10_000); // anti-vacuité : le corpus est bien lu

    const par = new Map<number, number>();
    let sansNote = 0;
    for (const r of recettes) {
      const v = estimerDifficulte(r);
      if (v.etoiles === null) sansNote++;
      else par.set(v.etoiles, (par.get(v.etoiles) ?? 0) + 1);
    }
    const notees = recettes.length - sansNote;

    // Mesuré le 14/09/2026 : 10 185 notées sur 10 188, 3 refusées faute de signaux.
    expect(notees / recettes.length).toBeGreaterThan(0.99);

    // ⚠️ LE test de ce lot. Mesuré : 19,9 / 19,8 / 20,2 / 20,0 / 20,0 %. Le plancher à 12 %
    // laisse de la marge à un ajustement de vocabulaire ou de nettoyage du texte, mais
    // interdit ce qui rendrait l'échelle décorative : un niveau qui s'écrase à presque rien
    // pendant que les autres se remplissent. Des seuils choisis au jugé produisent
    // exactement ça, parce que trois signaux corrélés et moyennés font une cloche.
    for (let i = 1; i <= ETOILES_MAX; i++) {
      const part = (par.get(i) ?? 0) / notees;
      expect(part, `${i} étoile(s)`).toBeGreaterThan(0.12);
      expect(part, `${i} étoile(s)`).toBeLessThan(0.30);
    }

    // Et le minimum de signaux n'est pas décoratif : quelques recettes DOIVENT être refusées,
    // sinon c'est que la garde ne tire jamais.
    expect(sansNote).toBeGreaterThan(0);
    expect(SIGNAUX_MINIMUM).toBe(2);
  });
});
