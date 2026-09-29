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
