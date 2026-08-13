// Préparation audio pour la transcription : mixage, plafond de durée, encodage WAV.
//
// L'enjeu du plafond est concret : une requête vers une fonction Vercel est bornée à
// 4,5 Mo, et du 16 kHz / 16 bits pèse 32 Ko par seconde. Un plafond mal calibré ferait
// rejeter la requête par la plateforme, avant notre code et sans message utile.

import { describe, expect, it } from "vitest";
import {
  DUREE_MAX_SEC,
  FREQUENCE_HZ,
  encoderWav,
  melangerEnMono,
  plafonnerDuree,
  poidsWavOctets,
} from "../lib/audio/wav";
import { extraireMessage } from "../lib/transcription";

/** Limite d'une requête vers une fonction serverless Vercel. */
const LIMITE_VERCEL_OCTETS = 4.5 * 1024 * 1024;

function lireAscii(vue: DataView, position: number, longueur: number): string {
  let texte = "";
  for (let i = 0; i < longueur; i++) texte += String.fromCharCode(vue.getUint8(position + i));
  return texte;
}

describe("melangerEnMono", () => {
  it("moyenne les canaux plutôt que d'en jeter un", () => {
    // Un enregistrement d'écran est souvent stéréo : garder un seul canal perdrait celui
    // où la voix est la plus forte.
    const gauche = new Float32Array([1, 0, -1]);
    const droite = new Float32Array([0, 0.5, -0.5]);
    expect(Array.from(melangerEnMono([gauche, droite]))).toEqual([0.5, 0.25, -0.75]);
  });

  it("laisse un mono intact et tolère l'absence de canal", () => {
    const mono = new Float32Array([0.1, 0.2]);
    expect(melangerEnMono([mono])).toBe(mono);
    expect(melangerEnMono([]).length).toBe(0);
  });
});

describe("plafonnerDuree", () => {
  it("ne touche pas à une vidéo plus courte que le plafond", () => {
    expect(plafonnerDuree(45)).toEqual({ dureeTranscriteSec: 45, tronque: false });
  });

  it("tronque une vidéo trop longue ET le SIGNALE", () => {
    // Un plafond silencieux laisserait croire que toute la vidéo a été écoutée.
    expect(plafonnerDuree(300)).toEqual({ dureeTranscriteSec: DUREE_MAX_SEC, tronque: true });
  });

  it("une durée absurde ne produit aucun audio", () => {
    expect(plafonnerDuree(0).dureeTranscriteSec).toBe(0);
    expect(plafonnerDuree(Number.NaN).dureeTranscriteSec).toBe(0);
    expect(plafonnerDuree(-5).dureeTranscriteSec).toBe(0);
  });
});

describe("le plafond tient sous la limite de la plateforme", () => {
  it("le WAV le plus long possible passe une requête Vercel", () => {
    // Ce test est le vrai garde-fou du plafond : le dériver de la CONSTANTE plutôt que de
    // recopier « 120 » le rend juste même si quelqu'un relève DUREE_MAX_SEC un jour.
    const poids = poidsWavOctets(DUREE_MAX_SEC);
    expect(poids).toBeLessThan(LIMITE_VERCEL_OCTETS);
    // Et il reste de la marge pour l'enveloppe multipart (au moins 256 Ko).
    expect(LIMITE_VERCEL_OCTETS - poids).toBeGreaterThan(256 * 1024);
  });
});

describe("encoderWav", () => {
  it("produit un en-tête RIFF/WAVE valide et les bons paramètres", () => {
    const buffer = encoderWav(new Float32Array([0, 0.5, -0.5]), FREQUENCE_HZ);
    const vue = new DataView(buffer);
    expect(lireAscii(vue, 0, 4)).toBe("RIFF");
    expect(lireAscii(vue, 8, 4)).toBe("WAVE");
    expect(lireAscii(vue, 36, 4)).toBe("data");
    expect(vue.getUint16(22, true)).toBe(1); // mono
    expect(vue.getUint32(24, true)).toBe(FREQUENCE_HZ);
    expect(vue.getUint16(34, true)).toBe(16); // bits par échantillon
    expect(vue.getUint32(40, true)).toBe(3 * 2); // 3 échantillons × 2 octets
    expect(buffer.byteLength).toBe(44 + 6);
  });

  it("ÉCRÊTE les dépassements au lieu de les replier", () => {
    // Un dépassement replié transformerait un pic sonore en craquement — c'est-à-dire en
    // bruit que la reconnaissance vocale pourrait prendre pour un mot.
    const vue = new DataView(encoderWav(new Float32Array([2, -2])));
    expect(vue.getInt16(44, true)).toBe(32767);
    expect(vue.getInt16(46, true)).toBe(-32767);
  });

  it("un audio vide reste un WAV valide (juste sans données)", () => {
    const buffer = encoderWav(new Float32Array(0));
    expect(buffer.byteLength).toBe(44);
    expect(new DataView(buffer).getUint32(40, true)).toBe(0);
  });
});

describe("extraireMessage (diagnostic d'un échec de transcription)", () => {
  it("tire le message d'une erreur JSON du fournisseur", () => {
    // Un nom de modèle périmé doit se LIRE dans l'erreur, pas se deviner — même piège que
    // le message Zod sans chemin, vécu le même jour.
    const brut = JSON.stringify({ error: { message: "model `whisper-x` does not exist" } });
    expect(extraireMessage(brut)).toBe("model `whisper-x` does not exist");
  });

  it("retombe sur le texte brut quand ce n'est pas du JSON", () => {
    expect(extraireMessage("Service Unavailable")).toBe("Service Unavailable");
  });

  it("ne rend jamais une chaîne vide — « sans détail » vaut mieux que rien", () => {
    expect(extraireMessage("   ")).toBe("sans détail");
  });
});
