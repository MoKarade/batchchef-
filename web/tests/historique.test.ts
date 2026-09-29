// HIST-01 — fonctions PURES de l'historique (sans base).
// Les lignes sont des libellés de test neutres ; aucune n'est présentée comme une donnée de Marc.

import { describe, expect, it } from "vitest";
import {
  MESSAGE_HISTORIQUE_VIDE,
  cleRecette,
  etatHistorique,
  regrouperParRecette,
  regrouperParSemaine,
  type LigneHistorique,
} from "@/lib/historique";

let prochainId = 1;
function ligne(p: Partial<LigneHistorique> & { cuisineLe: Date }): LigneHistorique {
  return {
    id: prochainId++,
    batchId: 1,
    recipeId: 1,
    titre: "recette-test",
    sourceUrl: null,
    nomBatch: "batch-test",
    portions: 4,
    ...p,
  };
}

describe("cleRecette (C6)", () => {
  it("prend la source d'abord, puis la fiche, puis le titre", () => {
    const d = new Date("2026-09-01T12:00:00Z");
    expect(cleRecette(ligne({ cuisineLe: d, sourceUrl: "https://exemple.test/a", recipeId: 3 }))).toBe(
      "source:https://exemple.test/a",
    );
    expect(cleRecette(ligne({ cuisineLe: d, sourceUrl: null, recipeId: 3 }))).toBe("recette:3");
    expect(cleRecette(ligne({ cuisineLe: d, sourceUrl: null, recipeId: null, titre: "Titre-Test" }))).toBe(
      "titre:titre-test",
    );
  });
});

describe("regrouperParRecette (C6)", () => {
  it("compte, garde la dernière date et le titre le plus récent, trie par fréquence puis date", () => {
    const lignes = [
      ligne({ cuisineLe: new Date("2026-09-01T12:00:00Z"), sourceUrl: "https://exemple.test/a", titre: "ancien titre" }),
      ligne({ cuisineLe: new Date("2026-09-10T12:00:00Z"), sourceUrl: "https://exemple.test/a", titre: "nouveau titre" }),
      // Même source, autre fiche (recette ajoutée deux fois depuis le catalogue) : même groupe.
      ligne({ cuisineLe: new Date("2026-09-05T12:00:00Z"), sourceUrl: "https://exemple.test/a", recipeId: 9, titre: "ancien titre" }),
      ligne({ cuisineLe: new Date("2026-09-20T12:00:00Z"), recipeId: 2, titre: "autre" }),
      ligne({ cuisineLe: new Date("2026-09-15T12:00:00Z"), recipeId: 5, titre: "troisième" }),
    ];

    const r = regrouperParRecette(lignes);

    expect(r.map((f) => [f.titre, f.fois])).toEqual([
      ["nouveau titre", 3],
      ["autre", 1],
      ["troisième", 1],
    ]);
    expect(r[0]?.derniere.toISOString()).toBe("2026-09-10T12:00:00.000Z");
  });

  it("une recette retirée de la bibliothèque le dit (C5)", () => {
    const [f] = regrouperParRecette([ligne({ cuisineLe: new Date("2026-09-01T12:00:00Z"), recipeId: null })]);
    expect(f?.recetteRetiree).toBe(true);
    expect(f?.recipeId).toBeNull();
  });
});

describe("regrouperParSemaine (C7)", () => {
  it("un dimanche 21 h au Québec reste dans la semaine qui se termine", () => {
    // Dimanche 27/09/2026 à 21 h à Toronto (UTC−4) = lundi 28/09 01 h UTC.
    const dimancheSoir = new Date("2026-09-28T01:00:00Z");
    const lundiMidi = new Date("2026-09-28T16:00:00Z");
    const semaines = regrouperParSemaine([
      ligne({ cuisineLe: dimancheSoir, batchId: 1, nomBatch: "batch-dimanche" }),
      ligne({ cuisineLe: lundiMidi, batchId: 2, nomBatch: "batch-lundi" }),
    ]);

    expect(semaines.map((s) => s.semaine)).toEqual(["2026-W40", "2026-W39"]); // récent d'abord
    expect(semaines[1]?.lundi).toBe("21 septembre 2026");
    expect(semaines[1]?.cuissons[0]?.nomBatch).toBe("batch-dimanche");
    expect(semaines[0]?.lundi).toBe("28 septembre 2026");
  });

  it("regroupe les recettes d'une même cuisson, du plus récent au plus ancien", () => {
    const t1 = new Date("2026-09-22T15:00:00Z");
    const t2 = new Date("2026-09-24T15:00:00Z");
    const [semaine] = regrouperParSemaine([
      ligne({ cuisineLe: t1, batchId: 1, nomBatch: "b1", titre: "r1" }),
      ligne({ cuisineLe: t2, batchId: 2, nomBatch: "b2", titre: "r2" }),
      ligne({ cuisineLe: t1, batchId: 1, nomBatch: "b1", titre: "r3", recipeId: null }),
    ]);

    expect(semaine?.cuissons.map((c) => c.nomBatch)).toEqual(["b2", "b1"]);
    expect(semaine?.cuissons[1]?.recettes).toEqual([
      { titre: "r1", portions: 4, recipeId: 1, recetteRetiree: false },
      { titre: "r3", portions: 4, recipeId: null, recetteRetiree: true },
    ]);
    expect(semaine?.cuissons[1]?.date).toBe("22 septembre 2026");
  });

  it("un batch supprimé (batchId nul) reste une cuisson distincte", () => {
    const t = new Date("2026-09-22T15:00:00Z");
    const [semaine] = regrouperParSemaine([
      ligne({ cuisineLe: t, batchId: null, nomBatch: "supprimé-a" }),
      ligne({ cuisineLe: t, batchId: null, nomBatch: "supprimé-b" }),
    ]);
    expect(semaine?.cuissons).toHaveLength(2);
  });
});

describe("etatHistorique (C8)", () => {
  it("table vide : le message exact, aucun chiffre", () => {
    const e = etatHistorique([]);
    expect(e).toEqual({ type: "vide", message: MESSAGE_HISTORIQUE_VIDE });
    expect(MESSAGE_HISTORIQUE_VIDE).toBe(
      "Rien d'enregistré pour l'instant. L'historique commence à la première fois que tu termines un batch après la mise en ligne de cet écran.",
    );
    expect(MESSAGE_HISTORIQUE_VIDE).not.toMatch(/\d/);
  });

  it("rempli : date de départ = la plus ancienne cuisson, fréquences et semaines", () => {
    const e = etatHistorique([
      ligne({ cuisineLe: new Date("2026-09-24T15:00:00Z") }),
      ligne({ cuisineLe: new Date("2026-09-10T15:00:00Z") }),
    ]);
    expect(e.type).toBe("rempli");
    if (e.type !== "rempli") return;
    expect(e.depuis).toBe("10 septembre 2026");
    expect(e.frequences).toHaveLength(1);
    expect(e.semaines).toHaveLength(2);
  });
});
