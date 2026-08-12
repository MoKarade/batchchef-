// Échantillonnage d'une vidéo en images : ce qui est décidable est ici, et testé.
// Le reste (lecture du fichier par le navigateur) vit dans capture.ts, hors de portée d'un test.

import { describe, expect, it } from "vitest";
import {
  MAX_CAPTURES,
  MAX_FRAMES,
  base64Bytes,
  fitBudget,
  frameCountFor,
  frameTimestamps,
  isLikelyBase64,
  pickEvenly,
  repartirBudget,
  scaledSize,
} from "../lib/video/frames";

describe("frameCountFor", () => {
  it("adapte le nombre d'images à la durée, entre 4 et le plafond", () => {
    expect(frameCountFor(8)).toBe(4); // une vidéo courte n'a pas besoin de 12 images
    expect(frameCountFor(32)).toBe(8);
    expect(frameCountFor(600)).toBe(MAX_FRAMES); // plafonné
  });

  it("une vidéo sans durée exploitable ne donne aucune image (jamais une valeur par défaut)", () => {
    expect(frameCountFor(0)).toBe(0);
    expect(frameCountFor(Number.NaN)).toBe(0);
    expect(frameCountFor(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("frameTimestamps", () => {
  it("répartit les instants sur toute la durée sans prendre ni le tout début ni la toute fin", () => {
    const t = frameTimestamps(40, 4);
    expect(t).toEqual([5, 15, 25, 35]);
    expect(t[0]).toBeGreaterThan(0);
    expect(t[t.length - 1]).toBeLessThan(40);
  });

  it("couvre bien la seconde moitié (une recette se finit à la fin de la vidéo)", () => {
    const t = frameTimestamps(60, 6);
    expect(t.filter((x) => x > 30).length).toBe(3);
  });

  it("entrées invalides → aucun instant", () => {
    expect(frameTimestamps(30, 0)).toEqual([]);
    expect(frameTimestamps(0, 4)).toEqual([]);
    expect(frameTimestamps(Number.NaN, 4)).toEqual([]);
  });
});

describe("scaledSize", () => {
  it("réduit au côté le plus long en gardant le ratio", () => {
    expect(scaledSize(1080, 1920, 768)).toEqual({ width: 432, height: 768 });
    expect(scaledSize(1920, 1080, 768)).toEqual({ width: 768, height: 432 });
  });

  it("n'agrandit JAMAIS une petite vidéo (des pixels inventés coûteraient des tokens pour rien)", () => {
    expect(scaledSize(320, 240, 768)).toEqual({ width: 320, height: 240 });
  });

  it("dimensions absurdes → 0 (l'appelant échoue proprement)", () => {
    expect(scaledSize(0, 100)).toEqual({ width: 0, height: 0 });
  });
});

describe("pickEvenly", () => {
  it("prend des indices RÉPARTIS, pas les premiers", () => {
    expect(pickEvenly(5, 3)).toEqual([0, 2, 4]);
    expect(pickEvenly(10, 4)).toEqual([0, 3, 6, 9]);
  });

  it("k >= n → tout ; k = 1 → le milieu", () => {
    expect(pickEvenly(3, 5)).toEqual([0, 1, 2]);
    expect(pickEvenly(5, 1)).toEqual([2]);
  });
});

describe("fitBudget", () => {
  it("tout garder quand le budget suffit", () => {
    const r = fitBudget([100, 100, 100], 1000);
    expect(r.keptIndexes).toEqual([0, 1, 2]);
    expect(r.dropped).toBe(0);
    expect(r.totalBytes).toBe(300);
  });

  it("coupe en gardant la RÉPARTITION, pas le début de la vidéo", () => {
    // 5 images de 1000 o, budget 3000 → 3 images. Garder [0,1,2] ne montrerait que le début.
    const r = fitBudget([1000, 1000, 1000, 1000, 1000], 3000);
    expect(r.keptIndexes).toEqual([0, 2, 4]);
    expect(r.dropped).toBe(2);
  });

  it("compte les images écartées (elles doivent être DITES, jamais avalées)", () => {
    expect(fitBudget([1000, 1000, 1000, 1000], 2000).dropped).toBe(2);
  });

  it("une seule image déjà trop grosse → rien retenu (échec honnête, pas un lot tronqué)", () => {
    const r = fitBudget([5000, 5000], 1000);
    expect(r.keptIndexes).toEqual([]);
    expect(r.dropped).toBe(2);
  });

  it("aucune image en entrée → aucune en sortie", () => {
    expect(fitBudget([], 1000)).toEqual({ keptIndexes: [], totalBytes: 0, dropped: 0 });
  });
});

describe("repartirBudget (captures d'écran vs images de vidéo)", () => {
  it("sert les CAPTURES en premier : elles portent le texte, donc les quantités", () => {
    // Budget pour 3 images seulement. Les captures doivent passer avant les frames —
    // garder une douzième image de casserole en jetant la liste d'ingrédients serait absurde.
    const r = repartirBudget([1000, 1000], [1000, 1000, 1000, 1000], 3000);
    expect(r.capturesGardees).toEqual([0, 1]);
    expect(r.framesGardees).toHaveLength(1);
    expect(r.totalBytes).toBeLessThanOrEqual(3000);
  });

  it("laisse tout le budget à la vidéo quand il n'y a aucune capture", () => {
    const r = repartirBudget([], [1000, 1000, 1000], 3000);
    expect(r.capturesGardees).toEqual([]);
    expect(r.framesGardees).toEqual([0, 1, 2]);
    expect(r.framesEcartees).toBe(0);
  });

  it("plafonne le nombre de captures et COMPTE celles qui sautent", () => {
    const trop = new Array(MAX_CAPTURES + 2).fill(10);
    const r = repartirBudget(trop, [], 1_000_000);
    expect(r.capturesGardees).toHaveLength(MAX_CAPTURES);
    expect(r.capturesEcartees).toBe(2);
  });

  it("une capture trop lourde pour le budget est écartée, pas tronquée", () => {
    const r = repartirBudget([5000], [100], 1000);
    expect(r.capturesGardees).toEqual([]);
    expect(r.capturesEcartees).toBe(1);
    expect(r.framesGardees).toEqual([0]); // le reliquat profite quand même à la vidéo
  });
});

describe("isLikelyBase64 / base64Bytes", () => {
  it("accepte du base64 valide et refuse le reste (garde d'entrée côté serveur)", () => {
    expect(isLikelyBase64("YWJjZA==")).toBe(true);
    expect(isLikelyBase64("data:image/jpeg;base64,YWJjZA==")).toBe(false); // préfixe non retiré
    expect(isLikelyBase64("abc")).toBe(false); // longueur non multiple de 4
    expect(isLikelyBase64("")).toBe(false);
  });

  it("mesure la chaîne transmise, pas le binaire décodé", () => {
    expect(base64Bytes("YWJjZA==")).toBe(8);
  });
});
