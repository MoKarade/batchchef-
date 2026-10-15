// lib/actionsInternes/commun.ts — outils PURS partagés par les Server Actions et les fonctions de travail.
//
// Module ORDINAIRE (pas de "use server") : rien d'ici n'est un point d'entrée appelable
// depuis le navigateur. Cf. le verrou tests/actionsSession.test.ts.

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Traduit une exception en échec honnête, jamais avalé. */
export function fail(err: unknown): ActionResult {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/** Violation de contrainte FK Postgres (code 23503) — cf. NeonDbError. */
export function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "23503";
}

/** Phrase simple pour une page web qu'on n'a pas pu lire (jamais de code HTTP à l'écran). */
export function messagePageInjoignable(status: number): string {
  if (status === 401 || status === 403 || status === 429) {
    return "Ce site refuse d’être lu. Essaie plutôt la capture d’écran de la recette.";
  }
  if (status === 404 || status === 410) {
    return "Cette page n’existe plus. Vérifie le lien.";
  }
  return "Cette page n’a pas pu être lue. Réessaie plus tard, ou essaie la capture d’écran.";
}
