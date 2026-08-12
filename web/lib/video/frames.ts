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

/** Durée minimale d'une vidéo exploitable (s). En dessous, il n'y a rien à échantillonner. */
const MIN_DURATION_SEC = 0.5;

/**
 * Nombre d'images à prendre selon la durée : une vidéo de 8 s n'a pas besoin de 12 images,
 * une de 3 min si. ~1 image / 4 s, bornée à [4, MAX_FRAMES].
 */
export function frameCountFor(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec < MIN_DURATION_SEC) return 0;
  return Math.max(4, Math.min(MAX_FRAMES, Math.round(durationSec / 4)));
}

/**
 * Instants (en secondes) où prendre les images, répartis sur toute la durée.
 * On vise le MILIEU de chaque tranche : t=0 est souvent noir et la toute fin souvent un
 * écran de logo — deux images qui coûteraient des tokens sans rien apprendre.
 */
export function frameTimestamps(durationSec: number, count: number): number[] {
  if (!Number.isFinite(durationSec) || durationSec < MIN_DURATION_SEC) return [];
  if (!Number.isInteger(count) || count <= 0) return [];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(round2((durationSec * (i + 0.5)) / count));
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
