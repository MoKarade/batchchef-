// lib/semaineDb.ts contre une VRAIE base Postgres (PGlite en mémoire, vraies migrations).
//
// La logique de choix (`lib/semaine.ts`) est testée à part ; ici on éprouve ce qui ne se
// voit qu'en base : le type EFFECTIF (correction > estimation), l'exclusion de ce qui est
// déjà passé en cuisine, l'unicité `(semaine, position)`, l'atomicité des remplacements, et
// le relais honnête d'une panne d'écriture.
//
// ⚠️ Aucune donnée métier : les recettes sont des lignes minimales nommées pour leur rôle
// dans le test (« plat-1 », « dessert-1 »), jamais des recettes réelles. L'estimation de
// prix (appel LLM) est remplacée : on ne vérifie que ce que le module FAIT du résultat.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as moduleDb from "@/lib/db";
import type { BaseTest } from "./aides/baseTest";

vi.mock("@/lib/db", async () => {
  const { creerBaseTest } = await import("./aides/baseTest");
  const schema = await import("../lib/db/schema");
  const base = await creerBaseTest();
  return { db: base.db, schema, base };
});

const estimateShoppingCosts = vi.fn();
vi.mock("@/lib/llm", () => ({
  estimateShoppingCosts: (...a: unknown[]) => estimateShoppingCosts(...a),
}));

import { schema } from "@/lib/db";
import { fillMissingCosts } from "@/lib/aggregate";
import {
  apercuPlacement,
  lireSemaine,
  placerRecette,
  prixSemaine,
  regenererSemaine,
  remplacerPosition,
  roleDeLaPlace,
  semaineCourante,
} from "@/lib/semaineDb";

const base = (moduleDb as unknown as { base: BaseTest }).base;
const db = base.db;

// Un mercredi à midi (heure du Québec) : semaine ISO 2026-W38, loin de tout changement de jour.
const MAINTENANT = new Date("2026-09-16T16:00:00Z");
const SEMAINE = "2026-W38";
const SEMAINE_PRECEDENTE = "2026-W37";

let compteur = 0;

/** Pose une recette minimale du catalogue et rend son id. */
async function recette(
  type: string | null,
  options: { ingredients?: string[]; prep?: number | null; sourceUrl?: string; difficulte?: number | null } = {},
): Promise<number> {
  compteur += 1;
  const [ligne] = await db
    .insert(schema.catalogRecipes)
    .values({
      title: `${type ?? "sans-type"}-${compteur}`,
      sourceUrl: options.sourceUrl ?? `test://recette/${compteur}`,
      servings: 2,
      typeEstime: type,
      prepMinutes: options.prep === undefined ? 10 : options.prep,
      cuissonMinutes: 5,
      difficulteEstimee: options.difficulte ?? null,
    })
    .returning({ id: schema.catalogRecipes.id });
  const id = ligne!.id;
  const ings = options.ingredients ?? [`ingredient-propre-${compteur}`];
  if (ings.length > 0) {
    await db.insert(schema.catalogIngredients).values(
      ings.map((canonical) => ({ catalogRecipeId: id, name: canonical, canonical, qty: 100, unit: "g" as const })),
    );
  }
  return id;
}

/** Trois repas et un dessert : la composition minimale pour une semaine complète. */
async function catalogueComplet(): Promise<{ repas: number[]; dessert: number }> {
  const repas = [await recette("plat"), await recette("soupe"), await recette("salade")];
  const dessert = await recette("dessert");
  return { repas, dessert };
}

async function picks(semaine: string) {
  return db
    .select()
    .from(schema.weekPicks)
    .where(eq(schema.weekPicks.semaine, semaine))
    .orderBy(schema.weekPicks.position);
}

beforeEach(async () => {
  await base.vider();
  compteur = 0;
  estimateShoppingCosts.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lireSemaine", () => {
  it("rend une liste vide quand la semaine n'existe pas (et n'écrit rien)", async () => {
    await catalogueComplet();
    expect(await lireSemaine(SEMAINE)).toEqual([]);
    expect(await picks(SEMAINE)).toHaveLength(0);
  });

  it("rend les recettes dans l'ordre des places, avec le type EFFECTIF", async () => {
    const corrigee = await recette("sauce", { sourceUrl: "test://corrigee", difficulte: 3 });
    const inconnue = await recette("type-inconnu");
    await db.insert(schema.typeCorrections).values({ sourceUrl: "test://corrigee", type: "plat" });
    await db.insert(schema.weekPicks).values([
      { semaine: SEMAINE, catalogRecipeId: inconnue, position: 1 },
      { semaine: SEMAINE, catalogRecipeId: corrigee, position: 0 },
    ]);

    const lues = await lireSemaine(SEMAINE);
    expect(lues.map((r) => r.position)).toEqual([0, 1]);
    expect(lues[0]).toMatchObject({ catalogRecipeId: corrigee, type: "plat", difficulte: 3 });
    // Un type que l'app ne connaît pas est rendu `null`, jamais transmis tel quel.
    expect(lues[1]).toMatchObject({ catalogRecipeId: inconnue, type: null });
  });

  it("une correction « aucune famille » (null) l'emporte sur l'estimation à la lecture", async () => {
    const retiree = await recette("plat", { sourceUrl: "test://retiree" });
    await db.insert(schema.typeCorrections).values({ sourceUrl: "test://retiree", type: null });
    await db.insert(schema.weekPicks).values({ semaine: SEMAINE, catalogRecipeId: retiree, position: 0 });
    expect((await lireSemaine(SEMAINE))[0]).toMatchObject({ catalogRecipeId: retiree, type: null });
  });

  it("ne mélange pas deux semaines", async () => {
    const { repas } = await catalogueComplet();
    await db.insert(schema.weekPicks).values({ semaine: SEMAINE_PRECEDENTE, catalogRecipeId: repas[0]!, position: 0 });
    expect(await lireSemaine(SEMAINE)).toEqual([]);
  });
});

describe("semaineCourante", () => {
  it("catalogue vide : aucune proposition, rien d'écrit, pas d'erreur", async () => {
    const r = await semaineCourante(MAINTENANT);
    expect(r).toEqual({ semaine: SEMAINE, recettes: [], fabriquee: false });
    expect(await picks(SEMAINE)).toHaveLength(0);
  });

  it("fabrique trois repas puis un dessert, et le second appel relit sans refabriquer", async () => {
    const { repas, dessert } = await catalogueComplet();
    const premiere = await semaineCourante(MAINTENANT);
    expect(premiere.fabriquee).toBe(true);
    expect(premiere.recettes.map((r) => r.position)).toEqual([0, 1, 2, 3]);
    expect(new Set(premiere.recettes.slice(0, 3).map((r) => r.catalogRecipeId))).toEqual(new Set(repas));
    expect(premiere.recettes[3]!.catalogRecipeId).toBe(dessert);

    const seconde = await semaineCourante(MAINTENANT);
    expect(seconde.fabriquee).toBe(false);
    expect(seconde.recettes).toEqual(premiere.recettes);
    expect(await picks(SEMAINE)).toHaveLength(4);
  });

  it("efface la semaine précédente dans la même écriture (une seule semaine vivante)", async () => {
    const { repas } = await catalogueComplet();
    await db.insert(schema.weekPicks).values({ semaine: SEMAINE_PRECEDENTE, catalogRecipeId: repas[0]!, position: 0 });
    await semaineCourante(MAINTENANT);
    expect(await picks(SEMAINE_PRECEDENTE)).toHaveLength(0);
  });

  it("ne repropose pas une recette déjà passée en cuisine", async () => {
    await catalogueComplet();
    const cuisinee = await recette("plat", { sourceUrl: "test://cuisinee" });
    const [perso] = await db
      .insert(schema.recipes)
      .values({ title: "copie-perso", sourceUrl: "test://cuisinee", servings: 2 })
      .returning({ id: schema.recipes.id });
    const [lot] = await db.insert(schema.batches).values({ name: "lot-test" }).returning({ id: schema.batches.id });
    await db.insert(schema.batchRecipes).values({ batchId: lot!.id, recipeId: perso!.id, portions: 2 });

    const r = await semaineCourante(MAINTENANT);
    expect(r.recettes.map((x) => x.catalogRecipeId)).not.toContain(cuisinee);
  });

  it("tire sous le type CORRIGÉ : une sauce corrigée en plat devient tirable", async () => {
    const { repas, dessert } = await catalogueComplet();
    const promue = await recette("sauce", { sourceUrl: "test://promue" });
    await db.insert(schema.typeCorrections).values({ sourceUrl: "test://promue", type: "plat" });
    // On retire un repas d'origine pour que la recette promue soit NÉCESSAIRE.
    await db.delete(schema.catalogRecipes).where(eq(schema.catalogRecipes.id, repas[0]!));

    const ids = (await semaineCourante(MAINTENANT)).recettes.map((x) => x.catalogRecipeId);
    expect(ids).toContain(promue);
    expect(ids).toContain(dessert);
  });

  // SEM-BUG-TYPE-NUL (29/09) : l'ancien `coalesce(correction.type, typeEstime)` faisait
  // retomber une correction à `null` (« aucune de ces familles ») sur l'estimation.
  it("tire sous le type CORRIGÉ : une correction vers « aucune famille » écarte la recette", async () => {
    const { repas, dessert } = await catalogueComplet();
    const promue = await recette("sauce", { sourceUrl: "test://promue" });
    const retiree = await recette("plat", { sourceUrl: "test://retiree" });
    await db.insert(schema.typeCorrections).values([
      { sourceUrl: "test://promue", type: "plat" },
      { sourceUrl: "test://retiree", type: null },
    ]);
    // On retire un repas d'origine pour que la recette promue soit NÉCESSAIRE.
    await db.delete(schema.catalogRecipes).where(eq(schema.catalogRecipes.id, repas[0]!));

    const ids = (await semaineCourante(MAINTENANT)).recettes.map((x) => x.catalogRecipeId);
    expect(ids).toContain(promue);
    expect(ids).not.toContain(retiree);
    expect(ids).toContain(dessert);
  });

  it("course perdue contre un autre onglet : sert la proposition du gagnant", async () => {
    const { repas } = await catalogueComplet();
    vi.spyOn(db, "batch").mockImplementationOnce(async () => {
      // Le « gagnant » a écrit entre notre lecture et notre écriture.
      await db.insert(schema.weekPicks).values({ semaine: SEMAINE, catalogRecipeId: repas[1]!, position: 0 });
      throw new Error('duplicate key value violates unique constraint "week_picks_semaine_position"');
    });
    const r = await semaineCourante(MAINTENANT);
    expect(r.fabriquee).toBe(false);
    expect(r.recettes.map((x) => x.catalogRecipeId)).toEqual([repas[1]]);
  });

  it("panne réelle d'écriture : l'erreur est RELAYÉE, jamais rendue comme « rien à proposer »", async () => {
    await catalogueComplet();
    vi.spyOn(db, "batch").mockRejectedValueOnce(new Error("connexion perdue"));
    await expect(semaineCourante(MAINTENANT)).rejects.toThrow(
      "La proposition de la semaine n'a pas pu être enregistrée : connexion perdue",
    );
  });

  it("panne réelle d'écriture non-Error : la cause est quand même écrite", async () => {
    await catalogueComplet();
    vi.spyOn(db, "batch").mockRejectedValueOnce("refus brut");
    await expect(semaineCourante(MAINTENANT)).rejects.toThrow("refus brut");
  });

  it("la vraie contrainte d'unicité refuse une seconde proposition sur la même place", async () => {
    const { repas } = await catalogueComplet();
    await db.insert(schema.weekPicks).values({ semaine: SEMAINE, catalogRecipeId: repas[0]!, position: 0 });
    await expect(
      db.insert(schema.weekPicks).values({ semaine: SEMAINE, catalogRecipeId: repas[1]!, position: 0 }),
    ).rejects.toThrow();
  });
});

describe("prixSemaine", () => {
  it("rend null pour une semaine vide, sans appel", async () => {
    expect(await prixSemaine(SEMAINE, [])).toBeNull();
    expect(estimateShoppingCosts).not.toHaveBeenCalled();
  });

  it("rend null quand les recettes n'existent pas ou n'ont aucun ingrédient", async () => {
    expect(await prixSemaine(SEMAINE, [{ catalogRecipeId: 999 }])).toBeNull();
    const vide = await recette("plat", { ingredients: [] });
    expect(await prixSemaine(SEMAINE, [{ catalogRecipeId: vide }])).toBeNull();
    expect(estimateShoppingCosts).not.toHaveBeenCalled();
  });

  it("estime par ingrédient, écarte les ingrédients de fond, et mémorise le résultat", async () => {
    const a = await recette("plat", { ingredients: ["ingredient-a", "sel"] });
    const b = await recette("dessert", { ingredients: ["ingredient-b"] });
    let recus: Array<{ qty: number | null; unit: "g" | "ml" | "unite" | null }> = [];
    estimateShoppingCosts.mockImplementation(async (items: typeof recus) => {
      recus = items;
      return items.map(() => 1.25);
    });

    const r = await prixSemaine(SEMAINE, [{ catalogRecipeId: b }, { catalogRecipeId: a }]);
    const attendu = fillMissingCosts(recus, recus.map(() => 1.25)).reduce((t, c) => t + Math.round(c * 100), 0);
    expect(r).toEqual({ cents: attendu, methode: "llm", ecartes: ["sel"] });
    expect(recus).toHaveLength(2);

    const [stocke] = await db.select().from(schema.weekEstimations);
    // La signature est indépendante de l'ordre : ids triés.
    expect(stocke).toMatchObject({ semaine: SEMAINE, signature: `${a}-${b}`, prixCents: attendu, methode: "llm" });
  });

  it("même composition : relit le prix mémorisé sans rappeler le modèle", async () => {
    const a = await recette("plat");
    await db.insert(schema.weekEstimations).values({ semaine: SEMAINE, signature: `${a}`, prixCents: 1234, methode: "filet" });
    expect(await prixSemaine(SEMAINE, [{ catalogRecipeId: a }])).toEqual({ cents: 1234, methode: "filet", ecartes: [] });
    expect(estimateShoppingCosts).not.toHaveBeenCalled();
  });

  it("une méthode mémorisée inconnue est rendue comme « filet », jamais comme une estimation", async () => {
    const a = await recette("plat");
    await db.insert(schema.weekEstimations).values({ semaine: SEMAINE, signature: `${a}`, prixCents: 1, methode: "autre" });
    expect((await prixSemaine(SEMAINE, [{ catalogRecipeId: a }]))?.methode).toBe("filet");
  });

  it("composition changée : recalcule et remplace la ligne mémorisée", async () => {
    const a = await recette("plat");
    await db.insert(schema.weekEstimations).values({ semaine: SEMAINE, signature: "ancienne", prixCents: 1, methode: "llm" });
    estimateShoppingCosts.mockResolvedValue([2]);
    const r = await prixSemaine(SEMAINE, [{ catalogRecipeId: a }]);
    expect(r?.methode).toBe("llm");
    const lignes = await db.select().from(schema.weekEstimations);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ signature: `${a}`, prixCents: r!.cents });
  });

  it("appel LLM en panne : le prix existe quand même mais se DIT « filet »", async () => {
    const a = await recette("plat");
    estimateShoppingCosts.mockRejectedValue(new Error("API indisponible"));
    const r = await prixSemaine(SEMAINE, [{ catalogRecipeId: a }]);
    expect(r?.methode).toBe("filet");
    expect(r!.cents).toBeGreaterThan(0);
    const [stocke] = await db.select().from(schema.weekEstimations);
    expect(stocke?.methode).toBe("filet");
  });

  it("une mémorisation refusée par la base n'efface pas le prix calculé", async () => {
    const a = await recette("plat");
    estimateShoppingCosts.mockResolvedValue([3]);
    vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("écriture refusée");
    });
    const r = await prixSemaine(SEMAINE, [{ catalogRecipeId: a }]);
    expect(r).toMatchObject({ methode: "llm" });
    expect(await db.select().from(schema.weekEstimations)).toHaveLength(0);
  });
});

describe("roleDeLaPlace", () => {
  it("trois places de repas, puis le dessert", () => {
    expect([0, 1, 2, 3].map(roleDeLaPlace)).toEqual(["repas", "repas", "repas", "dessert"]);
  });
});

describe("remplacerPosition", () => {
  it("refuse une position hors de la semaine sans toucher la base", async () => {
    for (const p of [-1, 4, 1.5, Number.NaN]) {
      expect(await remplacerPosition(p, MAINTENANT)).toEqual({ ok: false, error: "Position hors de la semaine." });
    }
  });

  it("refuse quand la semaine n'existe pas (ne la fabrique pas)", async () => {
    await catalogueComplet();
    expect(await remplacerPosition(0, MAINTENANT)).toEqual({ ok: false, error: "Aucune proposition cette semaine." });
    expect(await picks(SEMAINE)).toHaveLength(0);
  });

  it("refuse une place vide dans une semaine incomplète", async () => {
    const { repas } = await catalogueComplet();
    await db.insert(schema.weekPicks).values({ semaine: SEMAINE, catalogRecipeId: repas[0]!, position: 0 });
    expect(await remplacerPosition(3, MAINTENANT)).toEqual({ ok: false, error: "Position introuvable dans la semaine." });
  });

  it("remplace un repas par un AUTRE repas, sans reprendre une recette de la semaine", async () => {
    await catalogueComplet();
    const semaine = await semaineCourante(MAINTENANT);
    const nouveau = await recette("plat");
    await recette("dessert");
    expect(await remplacerPosition(1, MAINTENANT)).toEqual({ ok: true });
    const apres = await lireSemaine(SEMAINE);
    expect(apres[1]!.catalogRecipeId).toBe(nouveau);
    // Les autres places n'ont pas bougé.
    expect(apres.filter((r) => r.position !== 1)).toEqual(semaine.recettes.filter((r) => r.position !== 1));
  });

  it("remplace le dessert par un dessert", async () => {
    await catalogueComplet();
    await semaineCourante(MAINTENANT);
    await recette("plat");
    const nouveau = await recette("dessert");
    expect(await remplacerPosition(3, MAINTENANT)).toEqual({ ok: true });
    expect((await lireSemaine(SEMAINE))[3]!.catalogRecipeId).toBe(nouveau);
  });

  it("préfère une remplaçante sans ingrédient distinctif commun avec les recettes gardées", async () => {
    const { repas } = await catalogueComplet();
    // « Distinctif » = présent dans au plus 2 % du catalogue : sur sept recettes, tout est
    // « commun ». On complète donc le corpus de lignes non proposables (sans ingrédient),
    // qui ne comptent que dans le dénominateur.
    await db.insert(schema.catalogRecipes).values(
      Array.from({ length: 200 }, (_, i) => ({ title: `remplissage-${i}`, typeEstime: "sauce" })),
    );
    await semaineCourante(MAINTENANT);
    const [garde] = await db
      .select({ canonical: schema.catalogIngredients.canonical })
      .from(schema.catalogIngredients)
      .where(eq(schema.catalogIngredients.catalogRecipeId, repas[0]!));
    // Deux candidates : une qui répète un ingrédient d'une recette gardée, une qui n'en répète aucun.
    const repetitive = await recette("plat", { ingredients: [garde!.canonical] });
    const variee = await recette("plat", { ingredients: ["ingredient-neuf"] });
    const positionDuRepas0 = (await lireSemaine(SEMAINE)).find((r) => r.catalogRecipeId === repas[0])!.position;
    const cible = positionDuRepas0 === 0 ? 1 : 0;
    expect(await remplacerPosition(cible, MAINTENANT)).toEqual({ ok: true });
    const choisie = (await lireSemaine(SEMAINE))[cible]!.catalogRecipeId;
    expect(choisie).toBe(variee);
    expect(choisie).not.toBe(repetitive);
  });

  it("plus rien à proposer : le dit, selon le rôle de la place", async () => {
    await catalogueComplet();
    await semaineCourante(MAINTENANT);
    expect(await remplacerPosition(0, MAINTENANT)).toEqual({ ok: false, error: "Plus aucun plat à proposer." });
    expect(await remplacerPosition(3, MAINTENANT)).toEqual({ ok: false, error: "Plus aucun dessert à proposer." });
  });
});

describe("apercuPlacement", () => {
  it("refuse une place qui n'existe pas", async () => {
    for (const place of [0, 5, 2.5]) {
      expect(await apercuPlacement(place, 1, MAINTENANT)).toEqual({ erreur: "Cette place n'existe pas dans la semaine." });
    }
  });

  it("refuse quand la place est vide cette semaine", async () => {
    const a = await recette("plat");
    expect(await apercuPlacement(1, a, MAINTENANT)).toEqual({ erreur: "Aucune proposition à cette place cette semaine." });
  });

  it("refuse une recette absente du catalogue (l'id vient d'un modèle)", async () => {
    await catalogueComplet();
    await semaineCourante(MAINTENANT);
    expect(await apercuPlacement(1, 99999, MAINTENANT)).toEqual({ erreur: "Cette recette n'existe pas dans le catalogue." });
  });

  it("annonce qu'un dessert à une place de repas casse la composition", async () => {
    await catalogueComplet();
    const semaine = await semaineCourante(MAINTENANT);
    const autreDessert = await recette("dessert");
    const r = await apercuPlacement(1, autreDessert, MAINTENANT);
    expect(r).toEqual({
      titre: `dessert-${compteur}`,
      type: "dessert",
      titreActuel: semaine.recettes[0]!.titre,
      casseComposition: true,
      roleAttendu: "repas",
    });
  });

  it("un repas à une place de repas, un dessert à la place du dessert : rien de cassé", async () => {
    await catalogueComplet();
    await semaineCourante(MAINTENANT);
    const plat = await recette("plat");
    const dessert = await recette("dessert");
    expect(await apercuPlacement(2, plat, MAINTENANT)).toMatchObject({ casseComposition: false, roleAttendu: "repas" });
    expect(await apercuPlacement(4, dessert, MAINTENANT)).toMatchObject({ casseComposition: false, roleAttendu: "dessert" });
    expect(await apercuPlacement(4, plat, MAINTENANT)).toMatchObject({ casseComposition: true });
  });

  it("une recette corrigée « aucune famille » est annoncée sans type, et casse la composition", async () => {
    await catalogueComplet();
    await semaineCourante(MAINTENANT);
    const retiree = await recette("plat", { sourceUrl: "test://retiree" });
    await db.insert(schema.typeCorrections).values({ sourceUrl: "test://retiree", type: null });
    expect(await apercuPlacement(1, retiree, MAINTENANT)).toMatchObject({ type: null, casseComposition: true });
  });

  it("une recette de type inconnu est rendue sans type et casse la composition", async () => {
    await catalogueComplet();
    await semaineCourante(MAINTENANT);
    const bizarre = await recette("type-inconnu");
    expect(await apercuPlacement(1, bizarre, MAINTENANT)).toMatchObject({ type: null, casseComposition: true });
  });
});

describe("placerRecette", () => {
  it("refuse une place invalide", async () => {
    expect(await placerRecette(0, 1, MAINTENANT)).toEqual({ ok: false, error: "Cette place n'existe pas dans la semaine." });
  });

  it("relaie le refus de l'aperçu sans rien écrire", async () => {
    await catalogueComplet();
    const semaine = await semaineCourante(MAINTENANT);
    expect(await placerRecette(1, 99999, MAINTENANT)).toEqual({
      ok: false,
      error: "Cette recette n'existe pas dans le catalogue.",
    });
    expect(await lireSemaine(SEMAINE)).toEqual(semaine.recettes);
  });

  it("pose la recette à la place demandée (1 à 4 → 0 à 3), et seulement là", async () => {
    await catalogueComplet();
    const avant = await semaineCourante(MAINTENANT);
    const plat = await recette("plat");
    expect(await placerRecette(2, plat, MAINTENANT)).toEqual({ ok: true, titre: `plat-${compteur}` });
    const apres = await lireSemaine(SEMAINE);
    expect(apres[1]!.catalogRecipeId).toBe(plat);
    expect(apres.filter((r) => r.position !== 1)).toEqual(avant.recettes.filter((r) => r.position !== 1));
  });
});

describe("regenererSemaine", () => {
  it("catalogue vide : le dit, sans rien écrire", async () => {
    expect(await regenererSemaine(MAINTENANT)).toEqual({ ok: false, error: "Plus aucune recette à proposer pour l'instant." });
    expect(await picks(SEMAINE)).toHaveLength(0);
  });

  it("remplace les quatre recettes de la semaine courante et garde les autres semaines intactes", async () => {
    const { repas } = await catalogueComplet();
    await db.insert(schema.weekPicks).values({ semaine: SEMAINE_PRECEDENTE, catalogRecipeId: repas[0]!, position: 0 });
    await semaineCourante(MAINTENANT);
    // `semaineCourante` a effacé W37 ; on la repose pour vérifier que la régénération n'y touche pas.
    await db.insert(schema.weekPicks).values({ semaine: SEMAINE_PRECEDENTE, catalogRecipeId: repas[0]!, position: 0 });
    expect(await regenererSemaine(MAINTENANT)).toEqual({ ok: true, recettes: 4 });
    expect(await picks(SEMAINE)).toHaveLength(4);
    expect(await picks(SEMAINE_PRECEDENTE)).toHaveLength(1);
  });

  it("écriture en échec : rend l'erreur et laisse l'ancienne proposition intacte (atomicité)", async () => {
    await catalogueComplet();
    const avant = await semaineCourante(MAINTENANT);
    vi.spyOn(db, "batch").mockRejectedValueOnce(new Error("connexion perdue"));
    expect(await regenererSemaine(MAINTENANT)).toEqual({
      ok: false,
      error: "La nouvelle proposition n'a pas pu être enregistrée : connexion perdue",
    });
    expect(await lireSemaine(SEMAINE)).toEqual(avant.recettes);
  });

  it("une vraie panne au milieu de la transaction annule aussi le retrait", async () => {
    await catalogueComplet();
    const avant = await semaineCourante(MAINTENANT);
    const original = db.batch.bind(db);
    vi.spyOn(db, "batch").mockImplementationOnce(async (requetes) =>
      // Le retrait passe, puis une insertion invalide (clé étrangère) fait échouer le lot.
      original([
        requetes[0]!,
        db.insert(schema.weekPicks).values({ semaine: SEMAINE, catalogRecipeId: 99999, position: 0 }),
      ]),
    );
    const r = await regenererSemaine(MAINTENANT);
    expect(r.ok).toBe(false);
    expect(await lireSemaine(SEMAINE)).toEqual(avant.recettes);
  });

  it("valeur rejetée non-Error : la cause est écrite", async () => {
    await catalogueComplet();
    vi.spyOn(db, "batch").mockRejectedValueOnce("refus brut");
    expect(await regenererSemaine(MAINTENANT)).toEqual({
      ok: false,
      error: "La nouvelle proposition n'a pas pu être enregistrée : refus brut",
    });
  });
});
