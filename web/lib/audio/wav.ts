// lib/audio/wav.ts — logique PURE de la préparation audio pour la transcription.
//
// Pourquoi du WAV brut plutôt qu'un format compressé : le navigateur ne sait pas encoder
// en MP3 ou en Opus sans bibliothèque tierce, et `MediaRecorder` encode en TEMPS RÉEL —
// une minute d'audio coûterait une minute d'attente. Un WAV 16 kHz mono 16 bits se
// fabrique en quelques millisecondes avec un DataView, sans aucune dépendance.
//
// 16 kHz mono : c'est exactement ce que Whisper consomme en interne. Envoyer mieux ne
// changerait rien à la transcription et ne ferait que gonfler la requête.

/** Fréquence d'échantillonnage attendue par Whisper. */
export const FREQUENCE_HZ = 16_000;

/**
 * Durée maximale envoyée à la transcription (s).
 *
 * ⚠️ C'est une contrainte de PLATEFORME, pas un choix de confort : une requête vers une
 * fonction Vercel est plafonnée à 4,5 Mo, et 16 kHz × 16 bits = 32 Ko par seconde. Deux
 * minutes pèsent 3,84 Mo — la marge restante absorbe l'enveloppe multipart.
 *
 * Au-delà, on transcrit le DÉBUT et on DIT combien a été couvert. Un plafond silencieux
 * laisserait croire que toute la vidéo a été écoutée.
 */
export const DUREE_MAX_SEC = 120;

/** Octets par échantillon (PCM 16 bits). */
const OCTETS_PAR_ECHANTILLON = 2;

/**
 * Mélange les canaux en mono par moyenne.
 * Un enregistrement d'écran est souvent stéréo alors que la voix est identique des deux
 * côtés : n'en garder qu'un perdrait le canal où le son est le plus fort.
 */
export function melangerEnMono(canaux: Float32Array[]): Float32Array {
  if (canaux.length === 0) return new Float32Array(0);
  const premier = canaux[0] as Float32Array;
  if (canaux.length === 1) return premier;
  const sortie = new Float32Array(premier.length);
  for (let i = 0; i < premier.length; i++) {
    let somme = 0;
    for (const canal of canaux) somme += canal[i] ?? 0;
    sortie[i] = somme / canaux.length;
  }
  return sortie;
}

/** Nombre d'échantillons réellement transcrits, et durée correspondante. */
export function plafonnerDuree(
  dureeSec: number,
  maxSec = DUREE_MAX_SEC,
): { dureeTranscriteSec: number; tronque: boolean } {
  if (!Number.isFinite(dureeSec) || dureeSec <= 0) {
    return { dureeTranscriteSec: 0, tronque: false };
  }
  if (dureeSec <= maxSec) return { dureeTranscriteSec: dureeSec, tronque: false };
  return { dureeTranscriteSec: maxSec, tronque: true };
}

/**
 * Encode des échantillons mono en WAV PCM 16 bits.
 *
 * Les valeurs hors de [-1, 1] sont ÉCRÊTÉES et non repliées : un dépassement replié
 * transformerait un pic sonore en craquement, c'est-à-dire en bruit que le modèle
 * pourrait prendre pour un mot.
 */
export function encoderWav(echantillons: Float32Array, frequenceHz = FREQUENCE_HZ): ArrayBuffer {
  const tailleDonnees = echantillons.length * OCTETS_PAR_ECHANTILLON;
  const tampon = new ArrayBuffer(44 + tailleDonnees);
  const vue = new DataView(tampon);

  ecrireAscii(vue, 0, "RIFF");
  vue.setUint32(4, 36 + tailleDonnees, true); // taille du fichier moins les 8 premiers octets
  ecrireAscii(vue, 8, "WAVE");
  ecrireAscii(vue, 12, "fmt ");
  vue.setUint32(16, 16, true); // taille du bloc fmt (PCM)
  vue.setUint16(20, 1, true); // format 1 = PCM entier
  vue.setUint16(22, 1, true); // 1 canal
  vue.setUint32(24, frequenceHz, true);
  vue.setUint32(28, frequenceHz * OCTETS_PAR_ECHANTILLON, true); // octets par seconde
  vue.setUint16(32, OCTETS_PAR_ECHANTILLON, true); // alignement d'un bloc
  vue.setUint16(34, 8 * OCTETS_PAR_ECHANTILLON, true); // bits par échantillon
  ecrireAscii(vue, 36, "data");
  vue.setUint32(40, tailleDonnees, true);

  let position = 44;
  for (let i = 0; i < echantillons.length; i++) {
    const valeur = Math.max(-1, Math.min(1, echantillons[i] ?? 0));
    vue.setInt16(position, Math.round(valeur * 32767), true);
    position += OCTETS_PAR_ECHANTILLON;
  }
  return tampon;
}

/** Poids du WAV produit pour une durée donnée — sert à vérifier qu'on tient sous la limite. */
export function poidsWavOctets(dureeSec: number, frequenceHz = FREQUENCE_HZ): number {
  return 44 + Math.max(0, Math.round(dureeSec * frequenceHz)) * OCTETS_PAR_ECHANTILLON;
}

function ecrireAscii(vue: DataView, position: number, texte: string): void {
  for (let i = 0; i < texte.length; i++) vue.setUint8(position + i, texte.charCodeAt(i));
}
