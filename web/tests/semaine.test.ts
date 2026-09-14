// Verrou de la proposition hebdomadaire (SEM-02).
//
// Ce qui compte ici : que la semaine ne bascule pas quatre heures trop tôt, que le tirage
// soit REJOUABLE (même semaine, même proposition), et que la variété ne soit pas décorative.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import initSqlJs from "sql.js";
import {
  MINUTES_COURTE,
  RECETTES_PAR_SEMAINE,
  SEUIL_COMMUN,
  TAILLE_PRESELECTION,
  choisirQuatre,
  empreinte,
  estCommun,
  estCourte,
  semaineISO,
  tempsTotal,
  type CandidateSemaine,
} from "../lib/semaine";

const c = (
  id: number,
  distinctifs: string[],
  prepMinutes: number | null = 20,
  cuissonMinutes: number | null = 40,
): CandidateSemaine => ({ id, titre: `Recette ${id}`, prepMinutes, cuissonMinutes, distinctifs });

describe("semaineISO — le fuseau de Marc, jamais celui du serveur", () => {
  it("un dimanche 20 h au Québec reste dans la semaine qui se termine", () => {
    // ⚠️ C'est LE cas qui justifie le fuseau : à cet instant il est déjà lundi en UTC, et
    // le serveur tourne en UTC. Sans `timeZone`, Marc verrait sa semaine changer le dimanche
    // soir. Mutation : retirer le fuseau rend « 2026-W38 » ici.
    expect(semaineISO(new Date("2026-09-14T00:30:00Z"))).toBe("2026-W37");
  });

  it("le lundi qui suit ouvre bien la semaine suivante", () => {
    expect(semaineISO(new Date("2026-09-14T16:00:00Z"))).toBe("2026-W38");
  });

  it("tient les bords d'année, où le numéro ne suit pas l'année civile", () => {
    // Le lundi 29 décembre 2025 appartient déjà à la semaine 1 de 2026 (règle du premier
    // jeudi), et le dimanche 3 janvier 2027 appartient encore à la 53e de 2026.
    expect(semaineISO(new Date("2025-12-29T17:00:00Z"))).toBe("2026-W01");
    expect(semaineISO(new Date("2026-01-01T17:00:00Z"))).toBe("2026-W01");
    expect(semaineISO(new Date("2027-01-03T17:00:00Z"))).toBe("2026-W53");
  });

  it("refuse une date invalide plutôt que de rendre une semaine fabriquée", () => {
    expect(() => semaineISO(new Date("n'importe quoi"))).toThrow(/invalide/);
  });
});

describe("les deux seuils, et le zéro qui ne veut pas dire zéro", () => {
  it("estCommun compare à la PART, pas à un compte", () => {
    expect(estCommun(300, 10_000)).toBe(true); // 3 %
    expect(estCommun(150, 10_000)).toBe(false); // 1,5 %
    expect(estCommun(SEUIL_COMMUN * 10_000, 10_000)).toBe(false); // pile au seuil : pas commun
  });

  it("un total de zéro est une donnée MANQUANTE, pas une recette instantanée", () => {
    // Même règle que lib/tempsRecette.ts — 224 recettes du corpus n'ont ni prépa ni cuisson.
    expect(tempsTotal(c(1, [], 0, 0))).toBeNull();
    expect(tempsTotal(c(1, [], null, null))).toBeNull();
    expect(estCourte(c(1, [], 0, 0))).toBe(false);
  });

  it("courte = un temps CONNU sous le seuil", () => {
    // Le seuil porte sur le TOTAL (prépa + cuisson), pas sur la cuisson seule.
    expect(estCourte(c(1, [], 10, MINUTES_COURTE - 20))).toBe(true);
    expect(estCourte(c(1, [], 10, MINUTES_COURTE - 10))).toBe(true); // pile au seuil
    expect(estCourte(c(1, [], 10, MINUTES_COURTE - 9))).toBe(false);
  });
});

describe("choisirQuatre", () => {
  const corpus = (): CandidateSemaine[] => [
    c(1, ["boeuf", "haricots"], 15, 65),
    c(2, ["poulet", "citron"], 10, 60),
    c(3, ["aubergine", "coco"], 15, 30),
    c(4, ["courgette", "celeri"], 10, 20),
    c(5, ["boeuf", "chorizo"], 20, 50),
    c(6, ["saumon", "aneth"], 10, 15),
    c(7, ["porc", "pruneaux"], 25, 90),
    c(8, ["poulet", "estragon"], 20, 45),
  ];

  it("rend exactement quatre recettes", () => {
    expect(choisirQuatre(corpus(), [], "2026-W38").recettes).toHaveLength(RECETTES_PAR_SEMAINE);
  });

  it("deux recettes retenues ne partagent JAMAIS un ingrédient distinctif", () => {
    // Mutation : retirer le test de compatibilité laisse passer deux « boeuf » ou deux
    // « poulet » — mesuré, ce cas échoue alors.
    const { recettes, varieteRelachee } = choisirQuatre(corpus(), [], "2026-W38");
    const vus = new Set<string>();
    for (const r of recettes) {
      for (const d of r.distinctifs) {
        expect(vus.has(d)).toBe(false);
        vus.add(d);
      }
    }
    expect(varieteRelachee).toBe(false);
  });

  it("le même numéro de semaine rend la MÊME proposition, une autre semaine en rend une autre", () => {
    // C'est ce qui empêche la proposition de changer quand Marc rafraîchit la page.
    const a = choisirQuatre(corpus(), [], "2026-W38").recettes.map((r) => r.id);
    const b = choisirQuatre(corpus(), [], "2026-W38").recettes.map((r) => r.id);
    const autre = choisirQuatre(corpus(), [], "2026-W39").recettes.map((r) => r.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(autre);
  });

  it("l'ordre d'arrivée des lignes ne change pas le tirage", () => {
    // Postgres ne garantit aucun ordre sans ORDER BY : un tirage qui dépendrait de l'ordre
    // des lignes changerait d'une requête à l'autre.
    const a = choisirQuatre(corpus(), [], "2026-W38").recettes.map((r) => r.id);
    const b = choisirQuatre([...corpus()].reverse(), [], "2026-W38").recettes.map((r) => r.id);
    expect(a).toEqual(b);
  });

  it("écarte ce qui est déjà passé en cuisine", () => {
    const sans = choisirQuatre(corpus(), [], "2026-W38").recettes.map((r) => r.id);
    const exclu = sans[0]!;
    const apres = choisirQuatre(corpus(), [exclu], "2026-W38").recettes.map((r) => r.id);
    expect(apres).not.toContain(exclu);
    expect(apres).toHaveLength(RECETTES_PAR_SEMAINE);
  });

  it("garantit au moins une recette courte quand il en existe une compatible", () => {
    // ⚠️ La graine est CHOISIE, et c'est le coeur du test : sous « 2026-W38 » la courte
    // (id 99) arrive PREMIÈRE dans l'ordre déterministe, donc elle serait retenue même sans
    // le bloc d'échange — le test passerait sans rien prouver. Mesuré : sous « 2026-W40 »
    // elle arrive DERNIÈRE des sept, après les six longues. C'est là que le bloc d'échange
    // est le seul à pouvoir la faire entrer.
    // Mutation : supprimer le bloc d'échange fait échouer ce cas.
    const longues = [
      c(11, ["a1"], 30, 60),
      c(12, ["a2"], 30, 60),
      c(13, ["a3"], 30, 60),
      c(14, ["a4"], 30, 60),
      c(15, ["a5"], 30, 60),
      c(16, ["a6"], 30, 60),
      c(99, ["courte"], 5, 10),
    ];
    const t = choisirQuatre(longues, [], "2026-W40");
    expect(t.recettes.some(estCourte)).toBe(true);
    expect(t.sansCourte).toBe(false);
  });

  it("le dit quand aucune courte n'existe, au lieu de faire comme si", () => {
    const t = choisirQuatre(
      [c(21, ["b1"], 40, 40), c(22, ["b2"], 40, 40), c(23, ["b3"], 40, 40), c(24, ["b4"], 40, 40)],
      [],
      "2026-W38",
    );
    expect(t.recettes).toHaveLength(RECETTES_PAR_SEMAINE);
    expect(t.sansCourte).toBe(true);
  });

  it("complète quand la variété ne peut pas être tenue — et le DIT", () => {
    // Cinq recettes qui partagent toutes le même ingrédient : impossible d'en tenir quatre
    // sans répétition. Rendre deux recettes en silence serait pire que le dire.
    const memeChose = [1, 2, 3, 4, 5].map((i) => c(i, ["tofu"], 10, 10));
    const t = choisirQuatre(memeChose, [], "2026-W38");
    expect(t.recettes).toHaveLength(RECETTES_PAR_SEMAINE);
    expect(t.varieteRelachee).toBe(true);
  });

  it("rend ce qu'il peut quand le corpus est plus petit que quatre", () => {
    const t = choisirQuatre([c(1, ["x"]), c(2, ["y"])], [], "2026-W38");
    expect(t.recettes).toHaveLength(2);
  });

  it("empreinte est stable et dépend de toute la chaîne", () => {
    expect(empreinte("2026-W38:42")).toBe(empreinte("2026-W38:42"));
    expect(empreinte("2026-W38:42")).not.toBe(empreinte("2026-W39:42"));
    expect(empreinte("2026-W38:42")).not.toBe(empreinte("2026-W38:43"));
  });
});

describe("le CORPUS RÉEL — la proposition tient-elle sur les 10 188 recettes", () => {
  const require_ = createRequire(import.meta.url);

  it("rend quatre recettes variées, avec au moins une courte, sur cinquante-deux semaines", async () => {
    const SQL = await initSqlJs({ locateFile: () => require_.resolve("sql.js/dist/sql-wasm.wasm") });
    const seed = new SQL.Database(readFileSync(resolve(process.cwd(), "data", "batchchef.seed.db")));

    const occurrences = new Map<string, number>();
    const parRecette = new Map<number, string[]>();
    const si = seed.prepare(
      `SELECT ri.recipe_id AS r, im.canonical_name AS n FROM recipe_ingredient ri
       JOIN ingredient_master im ON im.id = ri.ingredient_master_id`,
    );
    while (si.step()) {
      const row = si.getAsObject() as { r: number; n: string };
      const l = parRecette.get(row.r) ?? [];
      l.push(row.n);
      parRecette.set(row.r, l);
    }
    si.free();
    for (const noms of parRecette.values()) {
      for (const n of new Set(noms)) occurrences.set(n, (occurrences.get(n) ?? 0) + 1);
    }

    const candidates: CandidateSemaine[] = [];
    const sr = seed.prepare("SELECT id AS i, title AS t, prep_time_min AS p, cook_time_min AS k FROM recipe");
    while (sr.step()) {
      const row = sr.getAsObject() as { i: number; t: string; p: number | null; k: number | null };
      const noms = new Set(parRecette.get(row.i) ?? []);
      candidates.push({
        id: row.i,
        titre: row.t,
        prepMinutes: row.p,
        cuissonMinutes: row.k,
        distinctifs: [...noms].filter((n) => !estCommun(occurrences.get(n) ?? 0, candidates.length || 10_188)),
      });
    }
    sr.free();
    seed.close();

    expect(candidates.length).toBeGreaterThan(10_000); // anti-vacuité : le corpus est bien lu

    // ⚠️ La production ne passe PAS les 10 188 recettes à `choisirQuatre` : elle en
    // présélectionne `TAILLE_PRESELECTION` en SQL (charger 87 444 lignes d'ingrédients à
    // chaque fabrication serait absurde). Ce test doit donc éprouver ce que la production
    // FAIT, pas un ensemble qu'elle n'utilise jamais — sinon il prouve une propriété sur le
    // mauvais objet. On balaie plusieurs présélections tirées différemment : la propriété
    // doit tenir pour n'importe laquelle, ce qui est plus fort que de rejouer l'ordre SQL.
    const presélections: Array<(g: string) => CandidateSemaine[]> = [
      (g) => [...candidates].sort((x, y) => empreinte(`pre:${g}:${x.id}`) - empreinte(`pre:${g}:${y.id}`)).slice(0, TAILLE_PRESELECTION),
      (g) => [...candidates].sort((x, y) => empreinte(`autre:${g}:${x.id}`) - empreinte(`autre:${g}:${y.id}`)).slice(0, TAILLE_PRESELECTION),
      () => candidates.slice(0, TAILLE_PRESELECTION), // le pire cas : les ids les plus bas, sans mélange
    ];

    for (let s = 1; s <= 52; s += 1) {
      const graine = `2026-W${String(s).padStart(2, "0")}`;
      for (const tirer of presélections) {
        const sous = tirer(graine);
        expect(sous.length, graine).toBe(TAILLE_PRESELECTION);
        const p = choisirQuatre(sous, [], graine);
        expect(p.recettes, graine).toHaveLength(RECETTES_PAR_SEMAINE);
        expect(p.varieteRelachee, graine).toBe(false);
        expect(p.sansCourte, graine).toBe(false);
      }
      const t = choisirQuatre(candidates, [], graine);
      expect(t.recettes, graine).toHaveLength(RECETTES_PAR_SEMAINE);
      // Sur un corpus de cette taille, la variété ne se relâche jamais et une courte existe
      // toujours. Si l'un des deux bascule un jour, c'est le corpus qui a changé, pas le code.
      expect(t.varieteRelachee, graine).toBe(false);
      expect(t.sansCourte, graine).toBe(false);
      const vus = new Set<string>();
      for (const r of t.recettes) {
        for (const d of r.distinctifs) {
          expect(vus.has(d), `${graine} — ${d}`).toBe(false);
          vus.add(d);
        }
      }
    }

    // Deux semaines consécutives ne proposent pas la même chose.
    const a = choisirQuatre(candidates, [], "2026-W38").recettes.map((r) => r.id);
    const b = choisirQuatre(candidates, [], "2026-W39").recettes.map((r) => r.id);
    expect(a).not.toEqual(b);
  }, 120_000);
});
