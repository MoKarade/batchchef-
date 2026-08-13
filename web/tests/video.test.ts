// Échantillonnage d'une vidéo en images : ce qui est décidable est ici, et testé.
// Le reste (lecture du fichier par le navigateur) vit dans capture.ts, hors de portée d'un test.

import { describe, expect, it } from "vitest";
import {
  INTERVALLE_ECHANTILLON_SEC,
  MAX_CAPTURES,
  MAX_ECHANTILLONS,
  SEUIL_QUASI_IDENTIQUE,
  base64Bytes,
  choisirVignette,
  distanceEmpreintes,
  ecarterQuasiIdentiques,
  echantillonnerInstants,
  empreinte,
  fitBudget,
  isLikelyBase64,
  pickEvenly,
  repartirBudget,
  scaledSize,
} from "../lib/video/frames";

/** Empreinte factice UNIE — un « écran » d'une seule teinte, pratique pour raisonner. */
function ecranUni(valeur: number, taille = 64): number[] {
  return new Array(taille).fill(valeur);
}

/** Pixels RGBA d'une image unie, pour tester `empreinte` sans navigateur. */
function pixelsUnis(width: number, height: number, gris: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < width * height; i++) out.push(gris, gris, gris, 255);
  return out;
}

describe("echantillonnerInstants", () => {
  it("sonde la vidéo à la SECONDE, pas une douzaine de fois en tout", () => {
    // Le cœur du correctif : sur 40 s l'ancien échantillonnage prenait ~10 images espacées
    // de 4 s, et une carte de quantité affichée 2 s passait entre les mailles une fois sur deux.
    expect(echantillonnerInstants(40)).toHaveLength(40);
  });

  it("garantit un écart RÉEL inférieur à l'intervalle, même sur une durée non entière", () => {
    const t = echantillonnerInstants(40.5);
    const ecarts = t.slice(1).map((x, i) => x - (t[i] as number));
    expect(Math.max(...ecarts)).toBeLessThanOrEqual(INTERVALLE_ECHANTILLON_SEC);
  });

  it("plafonne le nombre de sondes et élargit l'intervalle plutôt que d'exploser", () => {
    // Un enregistrement d'écran de 5 min ne doit pas coûter 300 `seek` sur un téléphone.
    const t = echantillonnerInstants(300);
    expect(t).toHaveLength(MAX_ECHANTILLONS);
    expect(t[t.length - 1]).toBeLessThan(300);
  });

  it("ne prend ni le tout début ni la toute fin, et couvre la seconde moitié", () => {
    const t = echantillonnerInstants(60);
    expect(t[0]).toBeGreaterThan(0);
    expect(t[t.length - 1]).toBeLessThan(60);
    expect(t.filter((x) => x > 30).length).toBe(t.length / 2);
  });

  it("entrées invalides → aucune sonde (jamais une valeur par défaut)", () => {
    expect(echantillonnerInstants(0)).toEqual([]);
    expect(echantillonnerInstants(Number.NaN)).toEqual([]);
    expect(echantillonnerInstants(Number.POSITIVE_INFINITY)).toEqual([]);
    expect(echantillonnerInstants(60, 0)).toEqual([]);
  });
});

describe("empreinte", () => {
  it("une image unie donne une empreinte uniforme, à la luminance de la teinte", () => {
    const e = empreinte(pixelsUnis(32, 32, 120), 32, 32, 8);
    expect(e).toHaveLength(64);
    expect(Math.max(...e) - Math.min(...e)).toBeLessThan(0.001);
    expect(e[0]).toBeCloseTo(120, 5);
  });

  it("distingue les zones : une moitié noire et une moitié blanche ne se confondent pas", () => {
    const width = 32;
    const height = 32;
    const pixels: number[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const g = x < width / 2 ? 0 : 255;
        pixels.push(g, g, g, 255);
      }
    }
    const e = empreinte(pixels, width, height, 8);
    expect(e[0]).toBeCloseTo(0, 5); // colonne de gauche
    expect(e[7]).toBeCloseTo(255, 5); // colonne de droite
  });

  it("entrée incohérente → empreinte VIDE, jamais une empreinte partielle", () => {
    // Une empreinte tronquée se comparerait silencieusement de travers ; vide, elle rend
    // une distance de 1 et l'image est gardée.
    expect(empreinte(pixelsUnis(4, 4, 10), 32, 32, 8)).toEqual([]);
    expect(empreinte(pixelsUnis(8, 8, 10), 0, 8, 8)).toEqual([]);
  });
});

describe("distanceEmpreintes", () => {
  it("0 pour deux écrans identiques, 1 pour noir contre blanc", () => {
    expect(distanceEmpreintes(ecranUni(50), ecranUni(50))).toBe(0);
    expect(distanceEmpreintes(ecranUni(0), ecranUni(255))).toBe(1);
  });

  it("deux empreintes incomparables rendent 1 — donc l'image est GARDÉE, pas jetée", () => {
    expect(distanceEmpreintes([], [])).toBe(1);
    expect(distanceEmpreintes(ecranUni(10), ecranUni(10, 32))).toBe(1);
  });
});

describe("ecarterQuasiIdentiques", () => {
  it("un écran figé ne part qu'une fois", () => {
    const gardes = ecarterQuasiIdentiques([ecranUni(80), ecranUni(80), ecranUni(80), ecranUni(80)]);
    expect(gardes).toEqual([0]);
  });

  it("un changement franc est toujours gardé", () => {
    const gardes = ecarterQuasiIdentiques([ecranUni(0), ecranUni(0), ecranUni(255), ecranUni(255)]);
    expect(gardes).toEqual([0, 2]);
  });

  it("un DÉFILEMENT LENT reste capté : on compare à la dernière image GARDÉE", () => {
    // La légende qu'on fait glisser : chaque image ressemble à sa voisine immédiate
    // (écart 3/255 ≈ 0,012, sous le seuil), alors que l'écran a totalement changé au bout
    // de quelques secondes. Comparer de proche en proche ne garderait que la PREMIÈRE et
    // perdrait toute la légende — c'est précisément ce que ce test interdit.
    const rampe = Array.from({ length: 21 }, (_, i) => ecranUni(i * 3));
    expect(distanceEmpreintes(rampe[0] as number[], rampe[1] as number[])).toBeLessThan(
      SEUIL_QUASI_IDENTIQUE,
    );
    const gardes = ecarterQuasiIdentiques(rampe);
    expect(gardes).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  });

  it("aucune empreinte en entrée → aucune gardée", () => {
    expect(ecarterQuasiIdentiques([])).toEqual([]);
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

describe("choisirVignette", () => {
  it("propose le MILIEU : ni le titre du début, ni le logo de la fin", () => {
    // Sur un enregistrement d'écran, la fin est souvent la légende défilante — une photo
    // de recette qui ne montrerait que du texte.
    expect(choisirVignette(5)).toBe(2);
    expect(choisirVignette(4)).toBe(1);
    expect(choisirVignette(1)).toBe(0);
  });

  it("aucune vignette → aucun choix (jamais l'index 0 d'un tableau vide)", () => {
    expect(choisirVignette(0)).toBe(-1);
    expect(choisirVignette(-3)).toBe(-1);
  });
});
