// lib/lia/pause.ts — ce que la PAGE sait de la pause générale de LIA, pour l'option `pause` de lia-ui (≥ v0.31.0).
// PUR : la lecture réseau et l'horloge se passent en paramètres. Même règle que le hub (Hubperso `lib/liaPauseClient.ts`).
//
// ⚠️ CE N'EST QUE LE CÔTÉ CLIENT. Le vrai contrôle est au hub : `POST /api/lia/ask` y rend 423 sans appeler le modèle tant
// que la pause est posée (la route de l'app le relaie en 423). Ici on laisse seulement LIA se taire à l'écran (plus de
// parole spontanée, plus de question envoyée) sans attendre un refus.
//
// `pause()` de lia-ui est SYNCHRONE et relue à chaque pas : on garde la dernière lecture en mémoire, un minuteur la rafraîchit.
//
// ── ÉCHEC FERMÉ ───────────────────────────────────────────────────────────────────────
// Une pause qu'on ne sait pas lire vaut pause : jamais lue, session absente (401), invité (403), réseau en panne, réponse hors
// contrat. Une lecture réussie reste crue `VALIDITE_PAUSE_MS` (trois rafraîchissements) : un raté passager ne fait pas taire
// LIA, une panne qui dure oui. La page de connexion n'est pas concernée (voir `demarrage.ts` : aucun appel n'y part).

/** Fréquence de relecture de la pause. */
export const INTERVALLE_PAUSE_MS = 30_000;
/** Une lecture réussie reste crue ce temps ; au-delà, faute de nouvelle lecture, LIA se tait. */
export const VALIDITE_PAUSE_MS = 3 * INTERVALLE_PAUSE_MS;
/** Le minuteur regarde s'il faut relire à ce rythme (vite après une connexion, jamais plus d'un appel à la fois). */
export const PAS_SUIVI_PAUSE_MS = 5_000;

/**
 * Juge la réponse de `GET /api/lia/pause`. `true` / `false` : la pause lue ; `null` : illisible (statut autre que 200, JSON
 * absent, forme hors contrat). Jamais réparé : `{ "pause": "non" }` n'est pas « pas en pause ».
 */
export function lireReponsePause(statut: number, json: unknown): boolean | null {
  if (statut !== 200) return null;
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const pause = (json as Record<string, unknown>).pause;
  return typeof pause === "boolean" ? pause : null;
}

export interface SuiviPause {
  /** Relit la pause. N'échoue jamais : une lecture ratée est « illisible ». Un appel déjà en cours n'est pas doublé. */
  rafraichir(): Promise<void>;
  /** Faut-il relire maintenant ? Jamais lue, ou plus récente que `INTERVALLE_PAUSE_MS` : non. */
  doitRelire(): boolean;
  /** Ce qu'on passe à `pause` de lia-ui. Vrai tant que la pause est posée OU qu'on ne sait pas. */
  enPause(): boolean;
}

/** @param lire la lecture réseau : `true`/`false` ou `null` si illisible. Peut lever : c'est « illisible ». */
export function creerSuiviPause(lire: () => Promise<boolean | null>, maintenant: () => number): SuiviPause {
  let derniere: { pause: boolean; a: number } | null = null;
  let enCours: Promise<void> | null = null;
  return {
    rafraichir() {
      enCours ??= (async () => {
        let lue: boolean | null = null;
        try {
          lue = await lire();
        } catch {
          lue = null;
        }
        if (lue !== null) derniere = { pause: lue, a: maintenant() };
      })().finally(() => {
        enCours = null;
      });
      return enCours;
    },
    doitRelire() {
      return derniere === null || maintenant() - derniere.a >= INTERVALLE_PAUSE_MS;
    },
    enPause() {
      if (derniere === null) return true;
      if (maintenant() - derniere.a > VALIDITE_PAUSE_MS) return true;
      return derniere.pause;
    },
  };
}
