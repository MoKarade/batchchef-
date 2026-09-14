// Endpoint hub : conformité du summary au contrat + jeton à temps constant.

import { describe, expect, it } from "vitest";
import { validateSummary } from "@mokarade/hub-contract";
import { composeBatchchefSummary, plusRecent, type BatchchefCounts } from "../lib/hubSummary";

const BASE = "https://batchchef.example.com";

const COUNTS: BatchchefCounts = {
  recipes: 5,
  batches: 1,
  activeBatches: 1,
  toBuy: 4,
  budgetRemaining: 10,
  activeBatchId: null as number | null,
  activeBatchName: null,
  llmCostUsd: 0,
  lastActivityAt: null,
  semaine: null,
};

/** Une proposition de semaine telle que `lireSemaine` la rend (lecture seule). */
const SEMAINE = {
  semaine: "2026-W38",
  recettes: [
    { catalogRecipeId: 1, titre: "Gratin de courgettes au parmesan", imageUrl: null, prepMinutes: 15, cuissonMinutes: 45, position: 0, type: "plat" as const, difficulte: 3 },
    { catalogRecipeId: 2, titre: "Soupe de lentilles corail", imageUrl: null, prepMinutes: 10, cuissonMinutes: 25, position: 1, type: "soupe" as const, difficulte: 2 },
    { catalogRecipeId: 3, titre: "Salade de quinoa", imageUrl: null, prepMinutes: 20, cuissonMinutes: null, position: 2, type: "salade" as const, difficulte: 1 },
    // ⚠️ `difficulte: null` est un CAS, pas un remplissage : c'est la recette dont la source
    // ne dit rien — ni type, ni durée, ni note (SEM-05, 3 recettes sur 10 188).
    { catalogRecipeId: 4, titre: "Recette sans type ni durée", imageUrl: null, prepMinutes: null, cuissonMinutes: null, position: 3, type: null, difficulte: null },
  ],
};

describe("composeBatchchefSummary (conforme au contrat)", () => {
  it("base vide → status 'building' (jamais des 0 qui font croire à un état 'ok')", () => {
    const s = composeBatchchefSummary(
      { ...COUNTS, recipes: 0, batches: 0, activeBatches: 0, toBuy: 0, budgetRemaining: 0 },
      BASE,
    );
    expect(s.status).toBe("building");
    expect(s.app.id).toBe("batchchef");
    expect(s.contractVersion).toBe(1);
  });

  it("publie usage.cost (coût LLM en USD)", () => {
    const s = composeBatchchefSummary({ ...COUNTS, llmCostUsd: 0.37 }, BASE);
    expect(s.usage?.cost).toMatchObject({ amount: 0.37, currency: "USD", period: "total" });
  });

  it("avec des données → status 'ok', 4 métriques, action d'ouverture", () => {
    const s = composeBatchchefSummary(
      { ...COUNTS, recipes: 12, batches: 3, activeBatches: 2, toBuy: 7, budgetRemaining: 41.239 },
      BASE,
    );
    expect(s.status).toBe("ok");
    expect(s.metrics).toHaveLength(4);
    // budget arrondi au cent (jamais un flottant qui bave)
    expect(s.metrics.find((m) => m.label.startsWith("Budget"))?.value).toBe(41.24);
    expect(s.actions[0]).toMatchObject({ kind: "link", href: BASE });
  });

  it("batch actif → action « Liste d'épicerie » vers /courses/<id>", () => {
    const s = composeBatchchefSummary({ ...COUNTS, activeBatchId: 42 }, BASE);
    expect(s.actions.find((a) => a.label === "Liste d'épicerie")).toMatchObject({
      kind: "link",
      href: `${BASE}/courses/42`,
    });
  });

  it("aucun batch actif → pas d'action liste d'épicerie (jamais un lien mort)", () => {
    const s = composeBatchchefSummary({ ...COUNTS, activeBatchId: null }, BASE);
    expect(s.actions.some((a) => a.label === "Liste d'épicerie")).toBe(false);
  });

  it("articles à acheter → alerte info + sévérité warn sur la métrique", () => {
    const s = composeBatchchefSummary(COUNTS, BASE);
    expect(s.alerts).toHaveLength(1);
    expect(s.alerts[0]).toMatchObject({ severity: "info", href: `${BASE}/batchs` });
    expect(s.metrics.find((m) => m.label === "Articles à acheter")?.severity).toBe("warn");
  });

  it("rien à acheter → aucune alerte, sévérité 'ok'", () => {
    const s = composeBatchchefSummary(
      { ...COUNTS, activeBatches: 0, toBuy: 0, budgetRemaining: 0 },
      BASE,
    );
    expect(s.alerts).toHaveLength(0);
    expect(s.metrics.find((m) => m.label === "Articles à acheter")?.severity).toBe("ok");
  });
});


/* ---------- Contrat v1.3 : `primary`, `details`, et le seuil qu'on ne publie PAS ---------- */

describe("plusRecent — le dernier geste de Marc, quel qu'il soit", () => {
  it("rend le plus récent des deux instants", () => {
    // Pendant une semaine de courses, ce qui bouge est la case cochée ; le lundi d'un nouveau
    // lot, c'est le batch. Prendre un seul des deux publierait une fraîcheur périmée la
    // moitié du temps.
    const vieux = new Date("2026-09-01T12:00:00.000Z");
    const recent = new Date("2026-09-14T08:30:00.000Z");
    expect(plusRecent(vieux, recent)).toBe(recent.toISOString());
    expect(plusRecent(recent, vieux)).toBe(recent.toISOString());
  });

  it("tolère un seul des deux, et rend null quand il n'y a rien de daté", () => {
    const d = new Date("2026-09-14T08:30:00.000Z");
    expect(plusRecent(d, null)).toBe(d.toISOString());
    expect(plusRecent(null, d)).toBe(d.toISOString());
    expect(plusRecent(null, null)).toBeNull();
    // Une date illisible ne doit pas produire un « Invalid Date » publié tel quel.
    expect(plusRecent("pas-une-date", null)).toBeNull();
    expect(plusRecent("pas-une-date", d)).toBe(d.toISOString());
  });
});

describe("dataAsOf SANS expectedMaxAgeSec — la décision de BatchChef", () => {
  it("publie l'âge de la donnée, et AUCUN seuil pour le juger", () => {
    // ⚠️ C'EST UNE DÉCISION, PAS UN OUBLI. Les quatre autres apps ont un moteur qui passe
    // (tick, cron, poll), donc un rythme attendu. Ici il n'y en a pas : la donnée change
    // quand MARC cuisine. Un seuil ferait crier « BatchChef est figée » à chaque semaine où
    // il a mangé dehors. Le hub affiche alors l'âge et dit qu'il ne peut pas le juger
    // (`age-connu-non-juge`) — ce qui est exactement vrai.
    const at = "2026-09-10T18:00:00.000Z";
    const s = composeBatchchefSummary({ ...COUNTS, lastActivityAt: at }, BASE);
    expect(s.dataAsOf).toBe(at);
    expect(s.expectedMaxAgeSec).toBeUndefined();
  });

  it("aucune activité datée → aucun dataAsOf, jamais l'horloge du serveur", () => {
    // Publier `new Date()` ici dirait « la donnée est de l'instant » sur une base qui n'a
    // rien vu depuis des semaines : le mensonge que `dataAsOf` existe pour empêcher.
    const s = composeBatchchefSummary({ ...COUNTS, lastActivityAt: null }, BASE);
    expect(s.dataAsOf).toBeUndefined();
    expect(() => validateSummary(s)).not.toThrow();
  });
});

describe("primary — le chiffre de la carte SUIT ce qu'il y a à faire", () => {
  it("des courses à faire → « Articles à acheter »", () => {
    const s = composeBatchchefSummary({ ...COUNTS, toBuy: 7 }, BASE);
    expect(s.metrics.filter((m) => m.primary).map((m) => m.label)).toEqual(["Articles à acheter"]);
  });

  it("rien à acheter → « Batchs actifs »", () => {
    // DISCRIMINANT : sans le repli, la carte perdrait son titre dès que l'épicerie est
    // finie — c'est-à-dire pendant la moitié du cycle.
    const s = composeBatchchefSummary({ ...COUNTS, toBuy: 0 }, BASE);
    expect(s.metrics.filter((m) => m.primary).map((m) => m.label)).toEqual(["Batchs actifs"]);
  });

  it("UN SEUL primary dans tous les cas — le contrat refuse deux titres de carte", () => {
    for (const toBuy of [0, 1, 99]) {
      const s = composeBatchchefSummary({ ...COUNTS, toBuy }, BASE);
      expect(s.metrics.filter((m) => m.primary).length).toBe(1);
    }
  });

  it("« Recettes » n'est JAMAIS le chiffre mis en avant", () => {
    // Dix mille et des, et il ne bouge quasiment jamais : mettre en avant un nombre figé est
    // la façon la plus sûre de faire cesser de regarder une carte.
    for (const toBuy of [0, 5]) {
      const s = composeBatchchefSummary({ ...COUNTS, recipes: 10188, toBuy }, BASE);
      expect(s.metrics.find((m) => m.label === "Recettes")?.primary).toBeUndefined();
    }
  });
});

describe("details — la semaine LUE, et l'épicerie", () => {
  it("la proposition de la semaine devient une section titrée", () => {
    const s = composeBatchchefSummary({ ...COUNTS, semaine: SEMAINE }, BASE);
    const section = s.details?.find((d) => d.title === "Semaine 2026-W38");
    // Le NUMÉRO fait partie du libellé : il le rend unique (le contrat refuse deux lignes
    // de même libellé, et un refus fait basculer TOUT le summary en « error »), et c'est le
    // numéro auquel Marc parle — « remplace la deuxième ».
    expect(section?.items.map((i) => i.label)).toEqual([
      "1. Gratin de courgettes au parmesan",
      "2. Soupe de lentilles corail",
      "3. Salade de quinoa",
      "4. Recette sans type ni durée",
    ]);
    // Le type effectif et la durée TOTALE en précision — et rien quand on ne les a pas :
    // « Plat principal · 0 min » annoncerait une recette instantanée là où la durée manque.
    expect(section?.items[0]?.hint).toBe("Plat principal · 1 h");
    expect(section?.items[1]?.hint).toBe("Soupe · 35 min");
    expect(section?.items[2]?.hint).toBe("Salade · 20 min");
    expect(section?.items[3]?.hint).toBeUndefined();
  });

  it("pas encore de proposition → pas de section, jamais un encadré vide", () => {
    // C'est ce que le hub voit un lundi matin avant que Marc n'ouvre son app. Ce n'est pas
    // une anomalie — et surtout, le hub ne doit pas FABRIQUER la semaine en regardant.
    for (const semaine of [null, { semaine: "2026-W38", recettes: [] }]) {
      const s = composeBatchchefSummary({ ...COUNTS, semaine }, BASE);
      expect(s.details?.some((d) => d.title.startsWith("Semaine"))).toBe(false);
      // L'épicerie, elle, est toujours là : elle ne dépend pas de la semaine.
      expect(s.details?.some((d) => d.title === "Épicerie et cuisine")).toBe(true);
    }
  });

  it("les bornes du contrat tiennent (titres 40, précisions 80, 8 lignes par section)", () => {
    const s = composeBatchchefSummary(
      {
        ...COUNTS,
        semaine: {
          semaine: "S".repeat(60),
          recettes: Array.from({ length: 12 }, (_, i) => ({
            catalogRecipeId: i,
            titre: `Recette au titre démesurément long ${"x".repeat(120)}`,
            imageUrl: null,
            prepMinutes: 90,
            cuissonMinutes: 150,
            position: i,
            type: "plat" as const,
            difficulte: 5,
          })),
        },
      },
      BASE,
    );
    // `validateSummary` est appelé À L'ÉMISSION par `composeBatchchefSummary` : un
    // dépassement jetterait là-bas, donc ce test échouerait avant ses assertions.
    for (const section of s.details ?? []) {
      expect(section.title.length).toBeLessThanOrEqual(40);
      expect(section.items.length).toBeLessThanOrEqual(8);
      for (const item of section.items) {
        expect(item.label.length).toBeLessThanOrEqual(40);
        if (item.hint !== undefined) expect(item.hint.length).toBeLessThanOrEqual(80);
        if (typeof item.value === "string") expect(item.value.length).toBeLessThanOrEqual(60);
      }
    }
    expect(s.details?.[0]?.items.length).toBe(8);
  });

  it("deux titres qui se confondent après troncature ne font PAS tomber la carte entière", () => {
    // 🔴 LE CAS QUI A MOTIVÉ LE NUMÉRO. Le contrat refuse deux lignes de même libellé dans
    // une section, `composeBatchchefSummary` valide À L'ÉMISSION, et une exception là
    // basculerait tout le summary en `status: "error"` — « impossible de lire l'état » sur
    // la carte entière, à cause de deux titres qui partagent leurs 37 premiers caractères.
    // Sur 10 188 recettes, ça existe.
    const commun = "Gratin de pommes de terre et de courgettes au";
    const s = composeBatchchefSummary(
      {
        ...COUNTS,
        semaine: {
          semaine: "2026-W38",
          recettes: [
            { catalogRecipeId: 1, titre: `${commun} parmesan`, imageUrl: null, prepMinutes: null, cuissonMinutes: null, position: 0, type: null, difficulte: null },
            { catalogRecipeId: 2, titre: `${commun} comté`, imageUrl: null, prepMinutes: null, cuissonMinutes: null, position: 1, type: null, difficulte: null },
          ],
        },
      },
      BASE,
    );
    const labels = s.details![0]!.items.map((i) => i.label);
    expect(new Set(labels).size).toBe(2);
    expect(labels[0]!.startsWith("1. ")).toBe(true);
    expect(labels[1]!.startsWith("2. ")).toBe(true);
    // La VALEUR, elle, garde 60 caractères : c'est là que le plat se distingue.
    expect(s.details![0]!.items[0]!.value).not.toBe(s.details![0]!.items[1]!.value);
  });
});

describe("le nom du batch en cours", () => {
  it("part en alerte d'information — « Batchs actifs : 1 » ne dit pas ce qu'on cuisine", () => {
    const s = composeBatchchefSummary(
      { ...COUNTS, toBuy: 0, activeBatchName: "Lot de septembre" },
      BASE,
    );
    expect(s.alerts).toEqual([{ label: "En cours : Lot de septembre", severity: "info" }]);
  });

  it("un nom très long est tronqué à la borne du contrat, pas rejeté", () => {
    const s = composeBatchchefSummary(
      { ...COUNTS, toBuy: 0, activeBatchName: "N".repeat(200) },
      BASE,
    );
    expect(s.alerts[0]!.label.length).toBe(40);
    expect(s.alerts[0]!.label.endsWith("…")).toBe(true);
  });

  it("aucun batch actif → aucune alerte de nom (jamais « En cours : null »)", () => {
    const s = composeBatchchefSummary({ ...COUNTS, toBuy: 0, activeBatchName: null }, BASE);
    expect(s.alerts.some((a) => a.label.startsWith("En cours"))).toBe(false);
  });
});
