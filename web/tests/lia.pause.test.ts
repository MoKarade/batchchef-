// tests/lia.pause.test.ts — ce que la page sait de la pause de LIA : échec fermé, jamais « pas en pause » par défaut.

import { describe, expect, it } from "vitest";
import { INTERVALLE_PAUSE_MS, VALIDITE_PAUSE_MS, creerSuiviPause, lireReponsePause } from "../lib/lia/pause";

describe("lireReponsePause", () => {
  it("un 200 conforme rend la pause lue", () => {
    expect(lireReponsePause(200, { pause: true, modifieLe: null })).toBe(true);
    expect(lireReponsePause(200, { pause: false })).toBe(false);
  });

  it("tout le reste est illisible, jamais « pas en pause »", () => {
    for (const [statut, json] of [
      [401, { pause: false }],
      [403, { pause: false }],
      [503, { pause: false }],
      [200, null],
      [200, []],
      [200, {}],
      [200, { pause: "non" }],
      [200, { pause: 0 }],
    ] as const) {
      expect(lireReponsePause(statut, json)).toBeNull();
    }
  });
});

describe("creerSuiviPause", () => {
  const suivi = (lectures: Array<boolean | null | Error>) => {
    let t = 0;
    const lire = async () => {
      const suite = lectures.shift();
      if (suite instanceof Error) throw suite;
      return suite ?? null;
    };
    return { s: creerSuiviPause(lire, () => t), avancer: (ms: number) => (t += ms) };
  };

  it("jamais lue : en pause (échec fermé)", () => {
    const { s } = suivi([]);
    expect(s.enPause()).toBe(true);
    expect(s.doitRelire()).toBe(true);
  });

  it("lue pas en pause : LIA parle ; lue en pause : elle se tait", async () => {
    const a = suivi([false]);
    await a.s.rafraichir();
    expect(a.s.enPause()).toBe(false);
    const b = suivi([true]);
    await b.s.rafraichir();
    expect(b.s.enPause()).toBe(true);
  });

  it("une lecture illisible ou qui lève ne rend jamais « pas en pause »", async () => {
    const a = suivi([null]);
    await a.s.rafraichir();
    expect(a.s.enPause()).toBe(true);
    const b = suivi([new Error("réseau")]);
    await b.s.rafraichir();
    expect(b.s.enPause()).toBe(true);
  });

  it("un raté passager garde la dernière lecture ; une panne qui dure met LIA en pause", async () => {
    const { s, avancer } = suivi([false, null, null]);
    await s.rafraichir();
    avancer(INTERVALLE_PAUSE_MS);
    await s.rafraichir();
    expect(s.enPause()).toBe(false);
    avancer(VALIDITE_PAUSE_MS - INTERVALLE_PAUSE_MS + 1);
    await s.rafraichir();
    expect(s.enPause()).toBe(true);
  });

  it("une pause posée après une lecture « pas en pause » est vue à la relecture", async () => {
    const { s, avancer } = suivi([false, true]);
    await s.rafraichir();
    avancer(INTERVALLE_PAUSE_MS);
    expect(s.doitRelire()).toBe(true);
    await s.rafraichir();
    expect(s.enPause()).toBe(true);
  });

  it("une lecture récente n'est pas relue ; deux rafraîchissements simultanés ne font qu'un appel", async () => {
    let appels = 0;
    const s = creerSuiviPause(async () => (appels++, false), () => 0);
    await Promise.all([s.rafraichir(), s.rafraichir()]);
    expect(appels).toBe(1);
    expect(s.doitRelire()).toBe(false);
  });
});
