// Les OUTILS que Claude peut appeler pour fouiller la base lui-même.
//
// Décision de Marc (19/08/2026) : plutôt qu'un pré-filtre SQL suivi d'un seul appel, Claude
// interroge la base en plusieurs allers-retours. Il peut donc creuser — reformuler sa
// recherche, ouvrir une recette, revenir — au lieu d'être limité par un filtre écrit
// d'avance. Le coût par question est plus élevé, et il est mesuré (`recordLlmUsage`).
//
// 10 188 recettes : aucun modèle ne les reçoit d'un coup. Chaque outil rend donc peu de
// lignes, et la recherche par ingrédients calcule EN SQL ce qui est couvert et ce qui
// manque — c'est le travail que Claude ferait mal et cher en lisant tout.

import { and, eq, exists, ilike, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatQty } from "@/lib/aggregate";
import {
  MAX_RESULTATS_RECHERCHE,
  baliserDonnee,
  classerParDisponibilite,
  type RecetteTrouvee,
} from "./protocole";

export type SourceRecette = "catalogue" | "mes-recettes";

/** Déclaration des outils, au format attendu par l'API Messages. */
export const OUTILS = [
  {
    name: "chercher_recettes",
    description:
      "Cherche des recettes dans la base. Donne `ingredients` pour trouver ce qui se cuisine " +
      "avec ce que Marc a sous la main : la réponse dit, pour chaque recette, ce qui est " +
      "COUVERT et ce qui MANQUE (une recette à un ou deux manquants reste une bonne " +
      "suggestion). Donne `texte` pour chercher par titre. Les deux peuvent se combiner.",
    input_schema: {
      type: "object" as const,
      properties: {
        ingredients: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Ingrédients disponibles, en français, au singulier si possible.",
        },
        texte: { type: "string" as const, description: "Mots du titre recherché." },
        source: {
          type: "string" as const,
          enum: ["catalogue", "mes-recettes", "tout"],
          description:
            "« mes-recettes » = la bibliothèque de Marc (petite). « catalogue » = les 10 188 " +
            "recettes de découverte. Défaut : tout.",
        },
      },
    },
  },
  {
    name: "lire_recette",
    description:
      "Lit une recette en entier : ingrédients avec quantités, et préparation. À appeler " +
      "avant de proposer une recette précise ou d'en adapter une.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "number" as const },
        source: { type: "string" as const, enum: ["catalogue", "mes-recettes"] },
      },
      required: ["id", "source"],
    },
  },
  {
    name: "ingredients_les_plus_utilises",
    description:
      "Liste les ingrédients qui reviennent le plus dans la base, avec leur nombre de " +
      "recettes. Utile pour proposer des équivalents ancrés dans la base plutôt que dans " +
      "des généralités, ou pour savoir comment un ingrédient est nommé ici.",
    input_schema: {
      type: "object" as const,
      properties: {
        contient: {
          type: "string" as const,
          description: "Filtre optionnel sur le nom (ex. « poulet »).",
        },
      },
    },
  },
] as const;

export const NOMS_OUTILS = OUTILS.map((o) => o.name);

function borne(n: unknown, defaut: number, max: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : defaut;
  return Math.min(Math.max(v, 1), max);
}

function listeDeChaines(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string").map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

/**
 * Recherche par ingrédients disponibles.
 *
 * Le calcul « couverts / manquants » se fait en SQL, sur les CANONIQUES : c'est exactement
 * le travail que Claude ferait mal (il faudrait lui envoyer toute la base) et que Postgres
 * fait bien. L'appariement d'un ingrédient demandé est volontairement TOLÉRANT (sous-chaîne)
 * — ici une correspondance trop large propose une recette de trop, ce qui se voit et se
 * jette ; à l'inverse d'une liste de courses, rien n'est écrit ni retiré sur cette base.
 */
async function chercherRecettes(args: Record<string, unknown>): Promise<string> {
  const ingredients = listeDeChaines(args.ingredients);
  const texte = typeof args.texte === "string" ? args.texte.trim() : "";
  const source = args.source === "catalogue" || args.source === "mes-recettes" ? args.source : "tout";
  if (ingredients.length === 0 && !texte) {
    return "Aucun critère : donne des ingrédients ou un texte à chercher.";
  }

  const trouvees: RecetteTrouvee[] = [];

  const sources: readonly SourceRecette[] =
    source === "tout" ? (["mes-recettes", "catalogue"] as const) : [source];
  for (const src of sources) {
    const estCatalogue = src === "catalogue";
    const tableR = estCatalogue ? schema.catalogRecipes : schema.recipes;
    const tableI = estCatalogue ? schema.catalogIngredients : schema.recipeIngredients;
    const cleR = estCatalogue ? schema.catalogIngredients.catalogRecipeId : schema.recipeIngredients.recipeId;

    const parIngredient = ingredients.map((ing) =>
      exists(
        db
          .select({ x: sql`1` })
          .from(tableI)
          .where(and(eq(cleR, tableR.id), ilike(tableI.canonical, `%${ing}%`))),
      ),
    );
    const conditions = [
      ...(texte ? [ilike(tableR.title, `%${texte}%`)] : []),
      ...(parIngredient.length > 0 ? [or(...parIngredient)!] : []),
    ];
    if (conditions.length === 0) continue;

    const lignes = await db
      .select({ id: tableR.id, titre: tableR.title })
      .from(tableR)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .limit(MAX_RESULTATS_RECHERCHE);
    if (lignes.length === 0) continue;

    const ids = lignes.map((l) => l.id);
    const ings = await db
      .select({ recetteId: cleR, canonical: tableI.canonical, name: tableI.name })
      .from(tableI)
      .where(inArray(cleR, ids));

    for (const ligne of lignes) {
      const deLaRecette = ings.filter((i) => i.recetteId === ligne.id);
      const couverts = ingredients.filter((dispo) =>
        deLaRecette.some((i) => i.canonical.includes(dispo)),
      );
      const manquants = deLaRecette
        .filter((i) => !ingredients.some((dispo) => i.canonical.includes(dispo)))
        .map((i) => i.name);
      trouvees.push({ id: ligne.id, source: src, titre: ligne.titre, couverts, manquants });
    }
  }

  if (trouvees.length === 0) return "Aucune recette ne correspond.";

  const classees = classerParDisponibilite(trouvees).slice(0, MAX_RESULTATS_RECHERCHE);
  const lignes = classees.map((r) => {
    const m = r.manquants.length;
    return (
      `- [${r.source} #${r.id}] ${r.titre} — couvre ${r.couverts.length}/${ingredients.length || "?"} ` +
      `de tes ingrédients ; ${m === 0 ? "rien ne manque" : `manque ${m} : ${r.manquants.slice(0, 8).join(", ")}${m > 8 ? "…" : ""}`}`
    );
  });
  return baliserDonnee("recherche", lignes.join("\n"));
}

async function lireRecette(args: Record<string, unknown>): Promise<string> {
  const id = borne(args.id, 0, Number.MAX_SAFE_INTEGER);
  const estCatalogue = args.source === "catalogue";
  const tableR = estCatalogue ? schema.catalogRecipes : schema.recipes;
  const tableI = estCatalogue ? schema.catalogIngredients : schema.recipeIngredients;
  const cleR = estCatalogue ? schema.catalogIngredients.catalogRecipeId : schema.recipeIngredients.recipeId;

  const [recette] = await db
    .select({
      titre: tableR.title,
      servings: tableR.servings,
      instructions: tableR.instructions,
    })
    .from(tableR)
    .where(eq(tableR.id, id));
  if (!recette) return `Aucune recette #${id} dans ${estCatalogue ? "le catalogue" : "tes recettes"}.`;

  const ings = await db
    .select({ name: tableI.name, qty: tableI.qty, unit: tableI.unit, note: tableI.note })
    .from(tableI)
    .where(eq(cleR, id));

  const corps = [
    `Titre : ${recette.titre}`,
    `Portions de référence : ${recette.servings}`,
    "Ingrédients :",
    ...ings.map(
      (i) => `  - ${i.name} : ${formatQty(i.qty, i.unit)}${i.note ? ` (${i.note})` : ""}`,
    ),
    recette.instructions ? `Préparation :\n${recette.instructions}` : "Préparation : non enregistrée.",
  ].join("\n");
  return baliserDonnee(estCatalogue ? "catalogue" : "mes-recettes", corps);
}

async function ingredientsLesPlusUtilises(args: Record<string, unknown>): Promise<string> {
  const contient = typeof args.contient === "string" ? args.contient.trim().toLowerCase() : "";
  const lignes = await db
    .select({
      nom: schema.catalogIngredients.canonical,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.catalogIngredients)
    .where(contient ? ilike(schema.catalogIngredients.canonical, `%${contient}%`) : undefined)
    .groupBy(schema.catalogIngredients.canonical)
    .orderBy(sql`count(*) desc`)
    .limit(MAX_RESULTATS_RECHERCHE);

  if (lignes.length === 0) return "Aucun ingrédient ne correspond.";
  return baliserDonnee(
    "frequences",
    lignes.map((l) => `- ${l.nom} : ${l.n} recettes`).join("\n"),
  );
}

/**
 * Exécute un outil. Une panne est RENDUE AU MODÈLE comme résultat, jamais lancée : Claude
 * peut alors reformuler ou le dire à Marc, là où une exception tuerait toute la réponse
 * après plusieurs appels déjà payés.
 */
export async function executerOutil(nom: string, args: Record<string, unknown>): Promise<string> {
  try {
    if (nom === "chercher_recettes") return await chercherRecettes(args);
    if (nom === "lire_recette") return await lireRecette(args);
    if (nom === "ingredients_les_plus_utilises") return await ingredientsLesPlusUtilises(args);
    return `Outil inconnu : ${nom}.`;
  } catch (err) {
    return `L'outil ${nom} a échoué : ${err instanceof Error ? err.message : String(err)}`;
  }
}
