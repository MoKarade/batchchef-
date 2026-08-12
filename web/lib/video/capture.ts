"use client";

// lib/video/capture.ts — extraction des images d'une vidéo DANS LE NAVIGATEUR.
//
// <video> + <canvas>, rien d'autre : aucune dépendance npm, aucun ffmpeg, aucun service tiers.
// Conséquence voulue : le fichier vidéo ne quitte jamais le PC de Marc — seules quelques
// images réduites partent vers le serveur, qui les transmet au LLM.
//
// Toute la logique décidable (instants, redimensionnement, budget) vit dans `frames.ts`,
// testée. Ici il ne reste que la mécanique DOM, qu'aucun test unitaire ne couvre.

import {
  JPEG_QUALITY,
  MAX_TOTAL_BASE64_BYTES,
  base64Bytes,
  fitBudget,
  frameCountFor,
  frameTimestamps,
  scaledSize,
} from "./frames";

export interface CaptureResult {
  /** Images JPEG en base64 (sans préfixe data:), dans l'ordre chronologique. */
  frames: string[];
  durationSec: number;
  /** Nombre d'images extraites avant application du budget. */
  captured: number;
  /** Images écartées faute de place — l'appelant DOIT le montrer, jamais l'avaler. */
  dropped: number;
}

/** Délai maximum d'attente d'un événement vidéo (ms) — sinon l'UI resterait figée. */
const EVENT_TIMEOUT_MS = 8000;

/**
 * Réduit une IMAGE (capture d'écran de la légende, photo d'une recette) au même format que
 * les images tirées d'une vidéo : JPEG borné, encodé en base64.
 *
 * Une capture d'écran de téléphone fait ~1080×2400 : l'envoyer telle quelle coûterait des
 * tokens sans rien ajouter — le texte reste lisible après réduction, c'est lui qui compte.
 */
export async function reduireImage(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await chargerImage(objectUrl);
    const size = scaledSize(image.naturalWidth, image.naturalHeight);
    if (size.width === 0 || size.height === 0) {
      throw new Error(`Image illisible : ${file.name}`);
    }
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponible : impossible de réduire l'image.");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return dataUrl.slice(dataUrl.indexOf(",") + 1);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function chargerImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => reject(new Error("Image trop longue à charger.")), EVENT_TIMEOUT_MS);
    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Image illisible par le navigateur."));
    };
    image.src = src;
  });
}

/**
 * Extrait des images réparties sur toute la durée de la vidéo.
 * Lève une erreur EXPLICITE si le navigateur ne sait pas lire le fichier ou si la vidéo
 * est inexploitable — jamais un tableau vide silencieux qui passerait pour « rien à voir ».
 */
export async function captureFrames(
  file: File,
  onProgress?: (done: number, total: number) => void,
  /** Budget d'octets laissé à la vidéo — les captures d'écran se servent en premier. */
  budgetMax: number = MAX_TOTAL_BASE64_BYTES,
): Promise<CaptureResult> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  try {
    await waitForEvent(video, "loadeddata", `Vidéo illisible par le navigateur (${file.type || "type inconnu"}).`);

    const durationSec = video.duration;
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      throw new Error("Durée de la vidéo introuvable : le fichier est probablement incomplet.");
    }
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width <= 0 || height <= 0) {
      throw new Error("Vidéo sans piste image (audio seul ?).");
    }

    const times = frameTimestamps(durationSec, frameCountFor(durationSec));
    if (times.length === 0) {
      throw new Error("Vidéo trop courte pour en tirer des images.");
    }

    const size = scaledSize(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponible : impossible d'extraire les images.");

    const shots: string[] = [];
    for (const [i, t] of times.entries()) {
      video.currentTime = Math.min(t, Math.max(0, durationSec - 0.05));
      await waitForEvent(video, "seeked", "Lecture de la vidéo interrompue.");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      if (b64) shots.push(b64);
      onProgress?.(i + 1, times.length);
    }

    if (shots.length === 0) {
      throw new Error("Aucune image n'a pu être extraite de la vidéo.");
    }

    const budget = fitBudget(shots.map(base64Bytes), budgetMax);
    if (budget.keptIndexes.length === 0) {
      throw new Error(
        "Plus de place pour les images de la vidéo : retire une capture d'écran ou prends une vidéo plus courte.",
      );
    }

    return {
      frames: budget.keptIndexes.map((i) => shots[i] as string),
      durationSec,
      captured: shots.length,
      dropped: budget.dropped,
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

/** Attend un événement vidéo, borné dans le temps et sensible aux erreurs de décodage. */
function waitForEvent(video: HTMLVideoElement, name: string, errorMessage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(name, onOk);
      video.removeEventListener("error", onError);
      clearTimeout(timer);
    };
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(errorMessage));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${errorMessage} (délai dépassé)`));
    }, EVENT_TIMEOUT_MS);

    video.addEventListener(name, onOk, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}
