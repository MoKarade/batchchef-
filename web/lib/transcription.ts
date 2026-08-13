// lib/transcription.ts — transcription de la piste audio d'une vidéo (Groq, Whisper).
//
// Pourquoi un service et pas un modèle local : sur une recette, une transcription
// approximative est PIRE que pas de transcription. « 250 g » entendu « 150 g » entrerait
// dans la liste d'épicerie sans que rien ne le signale. Whisper large sur Groq est
// nettement plus sûr sur du français parlé vite que ce qu'un petit modèle embarqué rendrait
// sur un téléphone (décision de Marc, 13/08/2026).
//
// Seule la piste AUDIO monte ici — jamais la vidéo, comme pour les images.
//
// ⚠️ Ce module ne LÈVE JAMAIS d'exception vers l'import : une transcription est un BONUS.
// Qu'elle soit désactivée, en panne ou vide, la recette doit continuer de se construire à
// partir du texte à l'écran et de la description. D'où un état explicite plutôt qu'un throw.

/** Modèle de transcription. Surchargeable : les noms de modèles bougent chez les fournisseurs. */
export const MODELE_TRANSCRIPTION =
  process.env.BATCHCHEF_MODELE_TRANSCRIPTION || "whisper-large-v3-turbo";

const URL_GROQ = "https://api.groq.com/openai/v1/audio/transcriptions";

/** Longueur maximale de transcription retenue (une recette parlée est courte). */
export const MAX_TRANSCRIPT_CHARS = 6000;

/** Délai au-delà duquel on abandonne la transcription plutôt que de faire attendre. */
const DELAI_MS = 45_000;

export type ResultatTranscription =
  /** Transcription obtenue. `texte` peut être vide si la vidéo est muette. */
  | { etat: "ok"; texte: string }
  /** Aucune clé configurée : l'intégration est ÉTEINTE, ce n'est pas une panne. */
  | { etat: "desactivee" }
  /** Échec réel, avec le motif tel que le fournisseur l'a dit. */
  | { etat: "echec"; motif: string };

/**
 * Transcrit un WAV.
 *
 * La distinction « désactivée » / « échec » compte : la première est un état de
 * configuration que Marc peut corriger en posant une clé, la seconde est un incident. Les
 * confondre sous un même « pas de transcription » rendrait l'un et l'autre invisibles.
 */
export async function transcrire(audio: Blob): Promise<ResultatTranscription> {
  const cle = process.env.GROQ_API_KEY;
  if (!cle) return { etat: "desactivee" };

  const corps = new FormData();
  corps.append("file", audio, "audio.wav");
  corps.append("model", MODELE_TRANSCRIPTION);
  corps.append("response_format", "json");
  // Température 0 : on veut ce qui a été DIT, pas une reformulation fluide.
  corps.append("temperature", "0");

  try {
    const reponse = await fetch(URL_GROQ, {
      method: "POST",
      headers: { authorization: `Bearer ${cle}` },
      body: corps,
      signal: AbortSignal.timeout(DELAI_MS),
    });

    const brut = await reponse.text();
    if (!reponse.ok) {
      // Le message du fournisseur est REPRIS tel quel : un nom de modèle périmé doit se
      // lire dans l'erreur, pas se deviner. C'est exactement le piège du message Zod sans
      // chemin, vécu le même jour.
      return { etat: "echec", motif: `HTTP ${reponse.status} — ${extraireMessage(brut)}` };
    }

    const donnees = JSON.parse(brut) as { text?: unknown };
    if (typeof donnees.text !== "string") {
      return { etat: "echec", motif: "réponse sans champ « text »" };
    }
    return { etat: "ok", texte: donnees.text.trim().slice(0, MAX_TRANSCRIPT_CHARS) };
  } catch (err) {
    return { etat: "echec", motif: err instanceof Error ? err.message : String(err) };
  }
}

/** Tire un message lisible d'une réponse d'erreur, qu'elle soit en JSON ou en texte brut. */
export function extraireMessage(brut: string, maxChars = 200): string {
  const court = brut.trim().slice(0, maxChars);
  try {
    const objet = JSON.parse(brut) as { error?: { message?: unknown }; message?: unknown };
    const message = objet.error?.message ?? objet.message;
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, maxChars);
  } catch {
    // Pas du JSON : le texte brut fait l'affaire, c'est déjà mieux que « échec ».
  }
  return court || "sans détail";
}
