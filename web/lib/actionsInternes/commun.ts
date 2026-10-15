// lib/actionsInternes/commun.ts — outils PURS partagés par les Server Actions et les fonctions de travail.
//
// Module ORDINAIRE (pas de "use server") : rien d'ici n'est un point d'entrée appelable
// depuis le navigateur. Cf. le verrou tests/actionsSession.test.ts.

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Messages techniques anglais connus (réseau, URL, base de données) → une phrase simple.
 * Un message déjà écrit en français pour l'écran n'est jamais touché : seuls ces motifs
 * sont traduits, le reste passe tel quel.
 */
const MOTIFS_TECHNIQUES: ReadonlyArray<readonly [RegExp, string]> = [
  [/invalid url/i, "Ce lien n’a pas l’air valide. Vérifie-le et réessaie."],
  [
    /failed to fetch|fetch failed|networkerror|econnrefused|enotfound|etimedout|econnreset|socket hang up/i,
    "La connexion a échoué. Vérifie ta connexion et réessaie.",
  ],
  [
    /failed query|neondberror|connection terminated|connection timeout|too many connections|relation ".*" does not exist/i,
    "La base de données ne répond pas pour le moment. Réessaie dans un instant.",
  ],
];

/** Remplace un message technique anglais connu par une phrase simple ; sinon le laisse tel quel. */
export function messageSimple(message: string): string {
  for (const [motif, phrase] of MOTIFS_TECHNIQUES) {
    if (motif.test(message)) return phrase;
  }
  return message;
}

/** Traduit une exception en échec honnête, jamais avalé. */
export function fail(err: unknown): ActionResult {
  return { ok: false, error: messageSimple(err instanceof Error ? err.message : String(err)) };
}

/** Violation de contrainte FK Postgres (code 23503) — cf. NeonDbError. */
export function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "23503";
}
