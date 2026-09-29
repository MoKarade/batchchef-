// Les outils de l'assistant (`lib/assistant/outils.ts`) contre une VRAIE base (PGlite en
// mémoire, vraies migrations). `idRecette` et `bornerResultat` sont testés dans
// `assistant.test.ts` ; ici on éprouve les requêtes et ce qui est rendu au modèle.
//
// ⚠️ Aucune donnée métier : lignes minimales nommées pour leur rôle dans le test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as moduleDb from "@/lib/db";
import type { BaseTest } from "./aides/baseTest";

vi.mock("@/lib/db", async () => {
  const { creerBaseTest } = await import("./aides/baseTest");
  const schema = await import("../lib/db/schema");
  const base = await creerBaseTest();
  return { db: base.db, schema, base };
});

import { schema } from "@/lib/db";
import { MAX_CARACTERES_RESULTAT, NOMS_OUTILS, compterCatalogue, executerOutil } from "@/lib/assistant/outils";
import { MAX_RESULTATS_RECHERCHE } from "@/lib/assistant/protocole";
import { semaineISO } from "@/lib/semaine";

const base = (moduleDb as unknown as { base: BaseTest }).base;
const db = base.db;

async function auCatalogue(
  titre: string,
  ingredients: Array<{ canonical: string; name?: string; qty?: number | null; unit?: "g" | "ml" | "unite" | null; note?: string | null }>,
  extra: { instructions?: string | null; typeEstime?: string | null; difficulteEstimee?: number | null } = {},
): Promise<number> {
  const [r] = await db
    .insert(schema.catalogRecipes)
    .values({ title: titre, servings: 3, instructions: extra.instructions ?? null, typeEstime: extra.typeEstime ?? null, difficulteEstimee: extra.difficulteEstimee ?? null })
    .returning({ id: schema.catalogRecipes.id });
  if (ingredients.length > 0) {
    await db.insert(schema.catalogIngredients).values(
      ingredients.map((i) => ({
        catalogRecipeId: r!.id,
        canonical: i.canonical,
        name: i.name ?? i.canonical,
        qty: i.qty ?? null,
        unit: i.unit ?? null,
        note: i.note ?? null,
      })),
    );
  }
  return r!.id;
}

async function dansMesRecettes(titre: string, canoniques: string[]): Promise<number> {
  const [r] = await db.insert(schema.recipes).values({ title: titre, servings: 2 }).returning({ id: schema.recipes.id });
  if (canoniques.length > 0) {
    await db.insert(schema.recipeIngredients).values(
      canoniques.map((c) => ({ recipeId: r!.id, canonical: c, name: c })),
    );
  }
  return r!.id;
}

beforeEach(async () => {
  await base.vider();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("déclaration des outils", () => {
  it("expose les quatre outils attendus par la boucle", () => {
    expect(NOMS_OUTILS).toEqual(["chercher_recettes", "lire_recette", "ingredients_les_plus_utilises", "lire_semaine"]);
  });
});

describe("executerOutil — aiguillage et pannes", () => {
  it("un outil inconnu est un résultat, pas une exception", async () => {
    expect(await executerOutil("outil_fantome", {})).toBe("Outil inconnu : outil_fantome.");
  });

  it("une panne de base est RENDUE au modèle, avec sa cause", async () => {
    vi.spyOn(db, "select").mockImplementation(() => {
      throw new Error("base-indisponible");
    });
    expect(await executerOutil("ingredients_les_plus_utilises", {})).toBe(
      "L'outil ingredients_les_plus_utilises a échoué : base-indisponible",
    );
  });

  it("une panne non-Error garde sa cause lisible", async () => {
    vi.spyOn(db, "select").mockImplementation(() => {
      throw "refus-brut";
    });
    expect(await executerOutil("lire_semaine", {})).toBe("L'outil lire_semaine a échoué : refus-brut");
  });
});

describe("chercher_recettes", () => {
  it("sans critère : le dit, sans toucher la base", async () => {
    const espion = vi.spyOn(db, "select");
    expect(await executerOutil("chercher_recettes", { ingredients: [" ", 3] })).toBe(
      "Aucun critère : donne des ingrédients ou un texte à chercher.",
    );
    expect(espion).not.toHaveBeenCalled();
  });

  it("aucun résultat : le dit", async () => {
    await auCatalogue("titre-a", [{ canonical: "ingredient-a" }]);
    expect(await executerOutil("chercher_recettes", { texte: "introuvable" })).toBe("Aucune recette ne correspond.");
  });

  it("par ingrédients : dit ce qui est couvert et ce qui manque, les plus complètes d'abord", async () => {
    await auCatalogue("recette-deux-manquants", [
      { canonical: "ingredient-x" },
      { canonical: "ingredient-m1", name: "manquant-un" },
      { canonical: "ingredient-m2", name: "manquant-deux" },
    ]);
    await auCatalogue("recette-complete", [{ canonical: "ingredient-x" }, { canonical: "ingredient-y" }]);
    await auCatalogue("recette-hors-sujet", [{ canonical: "ingredient-z" }]);

    const r = await executerOutil("chercher_recettes", { ingredients: ["Ingredient-X", "ingredient-y", "ingredient-x"], source: "catalogue" });
    expect(r.startsWith('<donnee source="recherche">')).toBe(true);
    const lignes = r.split("\n").filter((l) => l.startsWith("- "));
    expect(lignes).toHaveLength(2);
    expect(lignes[0]).toMatch(/recette-complete — couvre 2\/2 de tes ingrédients ; rien ne manque$/);
    expect(lignes[1]).toMatch(/recette-deux-manquants — couvre 1\/2 .* manque 2 : manquant-un, manquant-deux$/);
    expect(r).not.toContain("recette-hors-sujet");
  });

  it("par texte : cherche dans le titre, et « ? » quand aucun ingrédient n'est donné", async () => {
    await auCatalogue("titre-cherche", [{ canonical: "ingredient-a" }]);
    await auCatalogue("autre", [{ canonical: "ingredient-b" }]);
    const r = await executerOutil("chercher_recettes", { texte: "  cherche  " });
    expect(r).toContain("titre-cherche — couvre 0/? de tes ingrédients");
    expect(r).not.toContain("autre");
  });

  it("combine texte ET ingrédients (les deux doivent correspondre)", async () => {
    await auCatalogue("bon-titre", [{ canonical: "ingredient-a" }]);
    await auCatalogue("bon-titre-bis", [{ canonical: "ingredient-b" }]);
    const r = await executerOutil("chercher_recettes", { texte: "bon-titre", ingredients: ["ingredient-a"] });
    expect(r).toContain("[catalogue #1] bon-titre ");
    expect(r).not.toContain("bon-titre-bis");
  });

  it("source : « mes-recettes » ne lit que la bibliothèque, « tout » lit les deux", async () => {
    await auCatalogue("au-catalogue", [{ canonical: "ingredient-commun" }]);
    await dansMesRecettes("dans-ma-bibliotheque", ["ingredient-commun"]);

    const perso = await executerOutil("chercher_recettes", { ingredients: ["ingredient-commun"], source: "mes-recettes" });
    expect(perso).toContain("[mes-recettes #1] dans-ma-bibliotheque");
    expect(perso).not.toContain("au-catalogue");

    const tout = await executerOutil("chercher_recettes", { ingredients: ["ingredient-commun"], source: "inconnue" });
    expect(tout).toContain("dans-ma-bibliotheque");
    expect(tout).toContain("au-catalogue");
  });

  it("tronque la liste des manquants au-delà de huit", async () => {
    await auCatalogue(
      "longue",
      [{ canonical: "ingredient-x" }, ...Array.from({ length: 10 }, (_, i) => ({ canonical: `m-${i}`, name: `m-${i}` }))],
    );
    const r = await executerOutil("chercher_recettes", { ingredients: ["ingredient-x"] });
    expect(r).toContain("manque 10 : m-0, m-1, m-2, m-3, m-4, m-5, m-6, m-7…");
  });

  it("ne rend jamais plus de MAX_RESULTATS_RECHERCHE recettes", async () => {
    await db.insert(schema.catalogRecipes).values(
      Array.from({ length: MAX_RESULTATS_RECHERCHE + 5 }, (_, i) => ({ title: `serie-${i}` })),
    );
    const r = await executerOutil("chercher_recettes", { texte: "serie" });
    expect(r.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(MAX_RESULTATS_RECHERCHE);
  });
});

describe("lire_recette", () => {
  it("refuse un identifiant douteux ou une source inconnue, sans lire la base", async () => {
    const espion = vi.spyOn(db, "select");
    expect(await executerOutil("lire_recette", { id: 0, source: "catalogue" })).toBe(
      "Identifiant de recette invalide : donne le numéro rendu par la recherche.",
    );
    expect(await executerOutil("lire_recette", { id: 1, source: "ailleurs" })).toBe(
      "Source invalide : « catalogue » ou « mes-recettes ».",
    );
    expect(espion).not.toHaveBeenCalled();
  });

  it("recette absente : le dit, selon la source", async () => {
    expect(await executerOutil("lire_recette", { id: 5, source: "catalogue" })).toBe("Aucune recette #5 dans le catalogue.");
    expect(await executerOutil("lire_recette", { id: "5", source: "mes-recettes" })).toBe("Aucune recette #5 dans tes recettes.");
  });

  it("rend titre, portions, ingrédients avec quantités et note, et préparation, balisés comme DONNÉE", async () => {
    const id = await auCatalogue(
      "recette-lue",
      [
        { canonical: "ingredient-a", name: "nom-a", qty: 200, unit: "g", note: "note-a" },
        { canonical: "ingredient-b", name: "nom-b", qty: null, unit: null },
      ],
      { instructions: "etape-unique" },
    );
    const r = await executerOutil("lire_recette", { id, source: "catalogue" });
    expect(r.startsWith('<donnee source="catalogue">')).toBe(true);
    expect(r).toContain("Titre : recette-lue");
    expect(r).toContain("Portions de référence : 3");
    expect(r).toMatch(/- nom-a : .+ \(note-a\)/);
    expect(r).toContain("- nom-b : ");
    expect(r).toContain("Préparation :\netape-unique");
  });

  it("préparation absente : le dit plutôt que de laisser un trou", async () => {
    const id = await dansMesRecettes("sans-preparation", []);
    const r = await executerOutil("lire_recette", { id, source: "mes-recettes" });
    expect(r.startsWith('<donnee source="mes-recettes">')).toBe(true);
    expect(r).toContain("Préparation : non enregistrée.");
  });

  it("une préparation démesurée est tronquée, et la troncature est DITE", async () => {
    const id = await auCatalogue("longue", [], { instructions: "x".repeat(MAX_CARACTERES_RESULTAT * 2) });
    const r = await executerOutil("lire_recette", { id, source: "catalogue" });
    expect(r.length).toBeLessThan(MAX_CARACTERES_RESULTAT + 100);
    expect(r).toContain("Résultat tronqué");
  });
});

describe("ingredients_les_plus_utilises", () => {
  it("base vide : le dit", async () => {
    expect(await executerOutil("ingredients_les_plus_utilises", {})).toBe("Aucun ingrédient ne correspond.");
  });

  it("classe par nombre de recettes, et filtre sur le nom si demandé", async () => {
    await auCatalogue("r1", [{ canonical: "frequent" }, { canonical: "rare" }]);
    await auCatalogue("r2", [{ canonical: "frequent" }]);
    const tout = await executerOutil("ingredients_les_plus_utilises", {});
    expect(tout).toContain('<donnee source="frequences">');
    expect(tout.indexOf("- frequent : 2 recettes")).toBeLessThan(tout.indexOf("- rare : 1 recettes"));

    const filtre = await executerOutil("ingredients_les_plus_utilises", { contient: "  RAR " });
    expect(filtre).toContain("- rare : 1 recettes");
    expect(filtre).not.toContain("frequent");
  });
});

describe("lire_semaine", () => {
  it("pas de proposition : le dit, et n'en FABRIQUE pas", async () => {
    await auCatalogue("plat-1", [], { typeEstime: "plat" });
    const r = await executerOutil("lire_semaine", {});
    expect(r).toContain("Aucune proposition n'existe pour la semaine en cours.");
    expect(await db.select().from(schema.weekPicks)).toHaveLength(0);
  });

  it("rend les places de 1 à 4, le rôle attendu, le type et la difficulté", async () => {
    const semaine = semaineISO(new Date());
    const plat = await auCatalogue("plat-1", [], { typeEstime: "plat", difficulteEstimee: 2 });
    const inconnu = await auCatalogue("sans-type", [], { typeEstime: null });
    const dessert = await auCatalogue("dessert-1", [], { typeEstime: "dessert", difficulteEstimee: 9 });
    await db.insert(schema.weekPicks).values([
      { semaine, catalogRecipeId: plat, position: 0 },
      { semaine, catalogRecipeId: inconnu, position: 1 },
      { semaine, catalogRecipeId: dessert, position: 3 },
    ]);
    const r = await executerOutil("lire_semaine", {});
    expect(r).toContain(`Semaine ${semaine}, 3 recette(s) :`);
    expect(r).toMatch(new RegExp(`Place 1 \\(attend : plat, soupe ou salade\\) — plat-1 \\[catalogue #${plat}\\] · .+ · .+ \\(2/5\\)`));
    expect(r).toContain(`Place 2 (attend : plat, soupe ou salade) — sans-type [catalogue #${inconnu}] · type non déterminé · difficulté non estimée`);
    // Une difficulté hors 1-5 n'est pas affichée comme une note.
    expect(r).toMatch(new RegExp(`Place 4 \\(attend : dessert\\) — dessert-1 \\[catalogue #${dessert}\\] · .+ · difficulté non estimée`));
  });
});

describe("compterCatalogue", () => {
  it("rend le compte réel", async () => {
    expect(await compterCatalogue()).toBe(0);
    await auCatalogue("a", []);
    await auCatalogue("b", []);
    expect(await compterCatalogue()).toBe(2);
  });

  it("rend null plutôt que de lever si la base refuse", async () => {
    vi.spyOn(db, "select").mockImplementation(() => {
      throw new Error("base-indisponible");
    });
    expect(await compterCatalogue()).toBeNull();
  });
});
