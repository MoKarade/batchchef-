// lib/video/frames.ts — logique PURE de l'échantillonnage d'une vidéo en images.
// Aucune dépendance au DOM : c'est ici que vit tout ce qui se teste (choix des instants,
// redimensionnement, budget d'octets). La capture réelle vit dans `capture.ts` (navigateur).
//
// Pourquoi des images : l'API Anthropic ne lit pas une vidéo. On lui envoie des IMAGES
// prises à intervalles réguliers — c'est ce qui permet de lire le texte affiché à l'écran
// et de suivre l'ordre des gestes. L'extraction se fait dans le NAVIGATEUR (<video> +
// <canvas>, zéro dépendance, zéro ffmpeg) : la vidéo elle-même ne quitte jamais le PC.

/** Nombre d'images maximum envoyées au LLM pour une vidéo. */
export const MAX_FRAMES = 12;
/** Côté le plus long d'une image envoyée (px). Au-delà, on paie des tokens pour rien. */
export const MAX_EDGE_PX = 768;
/** Qualité JPEG de l'encodage des images. */
export const JPEG_QUALITY = 0.72;
/**
 * Budget TOTAL des images encodées en base64 (octets de la chaîne, c'est ce qui voyage).
 * 3 Mo : marge franche sous la limite de 4,5 Mo d'une fonction serverless Vercel — au-delà
 * la requête est rejetée par la plateforme, pas par notre code.
 */
export const MAX_TOTAL_BASE64_BYTES = 3_000_000;

/**
 * Captures d'écran maximum acceptées en une fois. Ce sont des images fournies telles
 * quelles, pas extraites d'une vidéo.
 *
 * Relevé de 4 à 8 le 2026-08-13 : le plafond initial supposait que les captures COMPLÈTENT
 * la vidéo (« la légende tient en 2-3 écrans »). Or Instagram ne laisse pas enregistrer la
 * vidéo de la plupart des reels — les captures deviennent donc le chemin PRINCIPAL, et il
 * leur faut de la place pour la légende ET les moments où les quantités s'affichent.
 * Coût : 8 captures réduites ≈ 640 Ko de base64, soit un cinquième du budget total.
 */
export const MAX_CAPTURES = 8;

/** Durée minimale d'une vidéo exploitable (s). En dessous, il n'y a rien à échantillonner. */
const MIN_DURATION_SEC = 0.5;

/**
 * Intervalle de SONDAGE de la vidéo (s) — à ne pas confondre avec le nombre d'images
 * envoyées au LLM (`MAX_FRAMES`).
 *
 * Pourquoi une seconde. L'échantillonnage régulier d'avant prenait ~12 images réparties sur
 * la durée, soit une toutes les 3 à 4 s sur un reel de 30 à 45 s. Une carte « 250 g de
 * beurre » affichée 2 s n'avait alors qu'une chance sur deux d'être vue : le fichier
 * contenait la quantité, notre échantillonnage la manquait. À une sonde par seconde, une
 * carte de 2 s est vue deux fois.
 */
export const INTERVALLE_ECHANTILLON_SEC = 1;

/**
 * Plafond du nombre d'instants sondés. Chaque sonde coûte un `seek` de l'élément <video>,
 * qui est LENT sur téléphone : sans plafond, un enregistrement d'écran de cinq minutes
 * ferait attendre Marc plusieurs minutes. Au-delà, l'intervalle s'élargit tout seul.
 */
export const MAX_ECHANTILLONS = 90;

/**
 * Instants (en secondes) à SONDER, denses et répartis sur toute la durée.
 * On vise le MILIEU de chaque tranche : t=0 est souvent noir et la toute fin souvent un
 * écran de logo — deux images qui coûteraient des tokens sans rien apprendre.
 */
export function echantillonnerInstants(
  durationSec: number,
  intervalleSec = INTERVALLE_ECHANTILLON_SEC,
  maxEchantillons = MAX_ECHANTILLONS,
): number[] {
  if (!Number.isFinite(durationSec) || durationSec < MIN_DURATION_SEC) return [];
  if (!(intervalleSec > 0) || !(maxEchantillons > 0)) return [];
  // `ceil` et non `floor` : c'est ce qui garantit un écart RÉEL ≤ `intervalleSec` entre deux
  // sondes. Avec `floor`, une vidéo de 40,5 s donnerait 40 sondes espacées de 1,0125 s — et
  // la promesse « une carte de 2 s est vue deux fois » cesserait d'être vraie.
  const n = Math.min(Math.floor(maxEchantillons), Math.max(1, Math.ceil(durationSec / intervalleSec)));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(round2((durationSec * (i + 0.5)) / n));
  }
  return out;
}

/** Dimensions réduites pour tenir dans `maxEdge`, ratio conservé. On n'AGRANDIT jamais. */
export function scaledSize(
  width: number,
  height: number,
  maxEdge = MAX_EDGE_PX,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/**
 * Choisit `k` indices RÉPARTIS parmi `n` (jamais « les k premiers »).
 * Couper un lot d'images par la fin reviendrait à ne montrer que le début de la recette.
 */
export function pickEvenly(n: number, k: number): number[] {
  if (n <= 0 || k <= 0) return [];
  if (k >= n) return Array.from({ length: n }, (_, i) => i);
  if (k === 1) return [Math.floor((n - 1) / 2)];
  const out: number[] = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.round((i * (n - 1)) / (k - 1));
    if (out[out.length - 1] !== idx) out.push(idx);
  }
  return out;
}

// ── Repérage des écrans DISTINCTS ──────────────────────────────────────────────
//
// Sonder une image par seconde ne sert à rien si on envoie ensuite douze images quasi
// identiques au LLM. Ce qu'on veut, c'est un exemplaire de chaque ÉCRAN : la légende
// dépliée, chaque carte de quantité, chaque geste. D'où une empreinte minuscule par
// instant sondé, et le rejet des sondes qui ne disent rien de neuf.

/** Côté de la grille d'empreinte (8×8 = 64 valeurs de gris). */
export const EMPREINTE_COTE = 8;

/**
 * En dessous de cette distance, deux images disent la même chose.
 *
 * Volontairement BAS. Se tromper en gardant une image de trop ne coûte rien — `pickEvenly`
 * la retirera si la place manque. Se tromper en écartant une carte de quantité fait perdre
 * la ligne de la recette qu'on cherchait, sans que rien ne le signale. Les deux erreurs ne
 * se valent pas, le seuil penche donc du côté qui garde.
 */
export const SEUIL_QUASI_IDENTIQUE = 0.02;

/**
 * Empreinte en niveaux de gris d'une image, calculée depuis des pixels RGBA.
 * Retourne `cote * cote` moyennes (0-255), ou `[]` si l'entrée est incohérente — jamais
 * une empreinte partielle, qui se comparerait silencieusement à côté.
 */
export function empreinte(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  cote = EMPREINTE_COTE,
): number[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return [];
  if (!Number.isInteger(cote) || cote <= 0) return [];
  if (pixels.length < width * height * 4) return [];

  const out: number[] = [];
  for (let cy = 0; cy < cote; cy++) {
    const y0 = Math.floor((cy * height) / cote);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / cote));
    for (let cx = 0; cx < cote; cx++) {
      const x0 = Math.floor((cx * width) / cote);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / cote));
      let somme = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          const p = (y * width + x) * 4;
          // Luminance perçue : un texte blanc sur fond coloré doit ressortir comme du contraste.
          somme += 0.299 * (pixels[p] ?? 0) + 0.587 * (pixels[p + 1] ?? 0) + 0.114 * (pixels[p + 2] ?? 0);
          n++;
        }
      }
      out.push(n > 0 ? somme / n : 0);
    }
  }
  return out;
}

/**
 * Distance entre deux empreintes, ramenée à [0, 1] (0 = identiques).
 * Deux empreintes incomparables (longueurs différentes, vides) rendent 1 : « je ne sais pas »
 * doit conduire à GARDER l'image, jamais à l'écarter en silence.
 */
export function distanceEmpreintes(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 1;
  let somme = 0;
  for (let i = 0; i < a.length; i++) somme += Math.abs((a[i] as number) - (b[i] as number));
  return Math.min(1, somme / a.length / 255);
}

/**
 * Garde un exemplaire de chaque écran distinct, dans l'ordre chronologique.
 *
 * La comparaison se fait avec la dernière image GARDÉE, pas avec la précédente : sur un
 * défilement lent (la légende qu'on fait glisser), chaque image ressemble à sa voisine
 * immédiate alors que l'écran a complètement changé en cinq secondes. Comparer de proche en
 * proche ne garderait qu'une seule image de toute la légende.
 */
export function ecarterQuasiIdentiques(
  empreintes: number[][],
  seuil = SEUIL_QUASI_IDENTIQUE,
): number[] {
  if (empreintes.length === 0) return [];
  const gardes = [0];
  let reference = empreintes[0] as number[];
  for (let i = 1; i < empreintes.length; i++) {
    const courante = empreintes[i] as number[];
    if (distanceEmpreintes(reference, courante) < seuil) continue;
    gardes.push(i);
    reference = courante;
  }
  return gardes;
}

export interface BudgetResult {
  /** Indices des images CONSERVÉES (dans l'ordre chronologique). */
  keptIndexes: number[];
  /** Octets totaux conservés. */
  totalBytes: number;
  /** Nombre d'images écartées faute de place — à DIRE à l'utilisateur, jamais en silence. */
  dropped: number;
}

/**
 * Garde le plus d'images possible sous `maxTotal`, en préservant la RÉPARTITION dans le temps.
 * Une image seule trop grosse pour le budget → aucune image retenue (échec honnête côté appelant).
 */
export function fitBudget(sizes: number[], maxTotal = MAX_TOTAL_BASE64_BYTES): BudgetResult {
  const n = sizes.length;
  if (n === 0) return { keptIndexes: [], totalBytes: 0, dropped: 0 };

  for (let k = n; k >= 1; k--) {
    const idx = pickEvenly(n, k);
    const total = idx.reduce((sum, i) => sum + (sizes[i] ?? 0), 0);
    if (total <= maxTotal) {
      return { keptIndexes: idx, totalBytes: total, dropped: n - idx.length };
    }
  }
  return { keptIndexes: [], totalBytes: 0, dropped: n };
}

export interface RepartitionBudget {
  /** Indices des captures d'écran conservées. */
  capturesGardees: number[];
  /** Indices des images de vidéo conservées. */
  framesGardees: number[];
  totalBytes: number;
  capturesEcartees: number;
  framesEcartees: number;
}

/**
 * Répartit le budget entre captures d'écran et images de vidéo.
 *
 * Les CAPTURES PASSENT EN PREMIER, et c'est le point important : une capture de la légende
 * porte les quantités écrites, alors qu'une image de vidéo ne montre souvent qu'un geste.
 * À budget serré, sacrifier une capture pour garder une douzième image de casserole
 * reviendrait à jeter la recette pour garder l'illustration.
 */
export function repartirBudget(
  taillesCaptures: number[],
  taillesFrames: number[],
  maxTotal = MAX_TOTAL_BASE64_BYTES,
): RepartitionBudget {
  const capturesGardees: number[] = [];
  let utilise = 0;
  for (let i = 0; i < taillesCaptures.length && i < MAX_CAPTURES; i++) {
    const taille = taillesCaptures[i] ?? 0;
    if (utilise + taille > maxTotal) break;
    capturesGardees.push(i);
    utilise += taille;
  }

  const budgetFrames = fitBudget(taillesFrames, Math.max(0, maxTotal - utilise));
  return {
    capturesGardees,
    framesGardees: budgetFrames.keptIndexes,
    totalBytes: utilise + budgetFrames.totalBytes,
    capturesEcartees: taillesCaptures.length - capturesGardees.length,
    framesEcartees: budgetFrames.dropped,
  };
}

/** Taille en octets d'une chaîne base64 (c'est elle qui transite, pas le binaire). */
export function base64Bytes(b64: string): number {
  return b64.length;
}

/** Une chaîne base64 plausible (garde d'entrée côté serveur : on ne fait pas confiance au client). */
export function isLikelyBase64(s: string): boolean {
  return s.length > 0 && s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
