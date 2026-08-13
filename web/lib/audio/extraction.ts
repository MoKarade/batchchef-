"use client";

// lib/audio/extraction.ts — extrait la piste audio d'une vidéo, DANS LE NAVIGATEUR.
//
// Le fichier vidéo ne monte toujours pas au serveur : on en tire ici une piste audio
// 16 kHz mono, réduite au strict nécessaire pour la transcription (~32 Ko par seconde).
// C'est la même frontière que pour les images — ce qui part est petit, dérivé, et borné.
//
// Toute la partie décidable (mixage, plafond de durée, encodage WAV) vit dans `wav.ts`,
// testée. Ici il ne reste que la mécanique Web Audio, qu'aucun test unitaire ne couvre.

import { DUREE_MAX_SEC, FREQUENCE_HZ, encoderWav, melangerEnMono, plafonnerDuree } from "./wav";

export interface AudioExtrait {
  /** WAV 16 kHz mono prêt à être transcrit. */
  blob: Blob;
  /** Durée réelle de la piste audio de la vidéo. */
  dureeSec: number;
  /** Durée effectivement envoyée — inférieure si la vidéo dépasse le plafond. */
  dureeTranscriteSec: number;
  /** `true` quand la fin n'a PAS été envoyée : l'appelant DOIT le dire. */
  tronque: boolean;
}

/**
 * Extrait l'audio, ou rend `null` quand la vidéo n'en a pas.
 *
 * ⚠️ « Pas de piste audio » n'est PAS une panne : un enregistrement d'écran muet est un cas
 * normal, et il ne doit pas faire échouer l'import. Une vraie erreur de décodage, elle, est
 * levée — c'est à l'appelant de choisir de continuer sans transcription, en le disant.
 */
export async function extraireAudio(file: File): Promise<AudioExtrait | null> {
  const donnees = await file.arrayBuffer();

  const contexte = new AudioContext();
  let decode: AudioBuffer;
  try {
    decode = await contexte.decodeAudioData(donnees);
  } catch {
    // Chrome lève une EncodingError aussi bien pour « aucune piste audio » que pour un
    // conteneur illisible. On ne peut pas les distinguer ici : dans les deux cas il n'y a
    // rien à transcrire, et l'import continue sans.
    return null;
  } finally {
    void contexte.close();
  }

  if (decode.length === 0 || decode.duration <= 0) return null;

  const { dureeTranscriteSec, tronque } = plafonnerDuree(decode.duration, DUREE_MAX_SEC);
  if (dureeTranscriteSec <= 0) return null;

  // Rééchantillonnage à 16 kHz : c'est l'OfflineAudioContext qui fait le filtrage correct,
  // bien mieux qu'une décimation maison qui replierait les aigus en sifflements.
  const cible = new OfflineAudioContext(
    1,
    Math.ceil(dureeTranscriteSec * FREQUENCE_HZ),
    FREQUENCE_HZ,
  );
  const source = cible.createBufferSource();
  source.buffer = decode;
  source.connect(cible.destination);
  source.start(0, 0, dureeTranscriteSec);
  const rendu = await cible.startRendering();

  const canaux: Float32Array[] = [];
  for (let i = 0; i < rendu.numberOfChannels; i++) canaux.push(rendu.getChannelData(i));
  const mono = melangerEnMono(canaux);

  return {
    blob: new Blob([encoderWav(mono, FREQUENCE_HZ)], { type: "audio/wav" }),
    dureeSec: decode.duration,
    dureeTranscriteSec,
    tronque,
  };
}
