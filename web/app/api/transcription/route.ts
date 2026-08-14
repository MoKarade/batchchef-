// POST /api/transcription — transcrit la piste audio extraite d'une vidéo.
//
// Pourquoi une route et pas une Server Action : l'audio est un binaire de plusieurs Mo. Une
// Server Action le ferait transiter en base64 (+33 %), ce qui dépasserait la limite de 4,5 Mo
// d'une fonction Vercel. En multipart, les octets passent tels quels.
//
// ⚠️ Cette route est PRIVÉE. Elle n'est pas dans `isPublicPath`, donc le middleware la garde
// et renvoie 401 (et non une redirection, puisqu'elle est sous /api). La session est
// revérifiée ICI malgré tout — même défense en profondeur que les Server Actions.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { poidsWavOctets, DUREE_MAX_SEC } from "@/lib/audio/wav";
import { transcrire } from "@/lib/transcription";

/** Transcrire deux minutes prend quelques secondes ; le défaut de 15 s serait juste. */
export const maxDuration = 60;

/** Marge au-dessus du WAV le plus long acceptable, pour l'enveloppe multipart. */
const TAILLE_MAX_OCTETS = poidsWavOctets(DUREE_MAX_SEC) + 64 * 1024;

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ ok: false, erreur: "non autorisé" }, { status: 401 });
  }

  let audio: FormDataEntryValue | null;
  try {
    audio = (await request.formData()).get("audio");
  } catch {
    return NextResponse.json({ ok: false, erreur: "corps illisible" }, { status: 400 });
  }

  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ ok: false, erreur: "aucun audio reçu" }, { status: 400 });
  }
  if (audio.size > TAILLE_MAX_OCTETS) {
    // Le client borne déjà la durée ; cette garde est le filet côté serveur, comme pour
    // les images. La plateforme rejetterait de toute façon, mais sans message utile.
    return NextResponse.json(
      { ok: false, erreur: `audio trop lourd (${Math.round(audio.size / 1024)} Ko)` },
      { status: 413 },
    );
  }

  const resultat = await transcrire(audio);
  // Toujours 200 : « désactivée » et « échec » ne sont pas des erreurs de LA REQUÊTE, et
  // l'appelant doit pouvoir continuer l'import en affichant honnêtement ce qui manque.
  return NextResponse.json(resultat, { headers: { "cache-control": "no-store" } });
}
