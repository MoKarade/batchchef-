// Ce que le MCP expose à Claude : lecture ET écriture (décision de Marc, 19/08/2026).
//
// ⚠️ Les écritures passent par les fonctions de TRAVAIL de l'app (`creerBatchInterne`,
// `cocherArticleInterne`, `ajouterDuCatalogueInterne`), jamais par du SQL réécrit ici. Deux
// implémentations d'une même règle, c'est une règle et demie : les garde-fous (ingrédients
// de fond écartés, estimation de prix, dédup du catalogue) doivent valoir pour un batch créé
// par Claude comme pour un batch créé au doigt.
//
// ⚠️ Ces fonctions ne portent PAS de contrôle d'accès — c'est voulu, et c'est pour ça
// qu'elles sont séparées des Server Actions. L'autorisation de CE chemin est le jeton
// `MCP_TOKEN`, vérifié dans `app/api/mcp/route.ts` AVANT d'arriver ici. Ne jamais appeler
// ces fonctions depuis un point d'entrée qui n'a pas fait sa propre preuve.
//
// Ce qui N'EST PAS exposé, volontairement : l'import d'une recette depuis une URL. Il coûte
// deux appels LLM et surtout il court-circuiterait l'écran de validation — or la règle du
// projet est « le LLM propose, le code valide, Marc confirme ». Un import sans relecture
// mettrait en base des quantités que personne n'a vues.

import { and, eq, ilike, inArray, or, sql, exists, desc } from "drizzle-orm";
import { normaliserPourRecherche } from "../rechercheNormalisee";
import { db, schema } from "@/lib/db";
import { formatQty } from "@/lib/aggregate";
import { formatMontant, progressionCourses } from "@/lib/courses";
import {
  ajouterDuCatalogueInterne,
  cocherArticleInterne,
  creerBatchInterne,
} from "@/lib/actions";
import { resultatOutil } from "./protocole";

// Ce que ces fonctions EXÉCUTENT est annoncé dans `declarations.ts` — un fichier de données
// pures, qui se teste sans démarrer une moitié de Next. La correspondance dans les deux sens
// (rien d'annoncé qui ne s'exécute, rien qui s'exécute sans être annoncé) est verrouillée par
// `tests/mcp.test.ts`.

/** Bornes des résultats : un outil rend peu de lignes, sinon le contexte explose. */
const MAX_RESULTATS = 25;
const MAX_CARACTERES = 6000;

function borner(texte: string): string {
  return texte.length <= MAX_CARACTERES
    ? texte
    : `${texte.slice(0, MAX_CARACTERES)}\n[…] Résultat tronqué : la suite n'a pas été lue.`;
}

/** Un identifiant se REFUSE, il ne se borne pas (cf. docs/LESSONS.md, 19/08). */
function idValide(n: unknown): number | null {
  const v = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  return Number.isInteger(v) && v > 0 ? v : null;
}

function chaines(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [
    ...new Set(
      v.filter((x): x is string => typeof x === "string").map((s) => s.trim().toLowerCase()).filter(Boolean),
    ),
  ];
}

async function chercherRecettes(a: Record<string, unknown>): Promise<string> {
  const ingredients = chaines(a.ingredients);
  const texte = typeof a.texte === "string" ? a.texte.trim() : "";
  if (ingredients.length === 0 && !texte) return "Donne des ingrédients ou un texte à chercher.";
  const source =
    a.source === "catalogue" || a.source === "mes-recettes" ? a.source : ("tout" as const);
  const sources: ReadonlyArray<"catalogue" | "mes-recettes"> =
    source === "tout" ? ["mes-recettes", "catalogue"] : [source];

  const lignes: string[] = [];
  for (const src of sources) {
    const cat = src === "catalogue";
    const R = cat ? schema.catalogRecipes : schema.recipes;
    const I = cat ? schema.catalogIngredients : schema.recipeIngredients;
    const cle = cat ? schema.catalogIngredients.catalogRecipeId : schema.recipeIngredients.recipeId;

    // ⚠️ Colonnes NORMALISÉES des deux côtés (CAT-B). L'outil cherchait dans `canonical`,
    // qui porte les accents (`crème_liquide`) : « creme » n'y trouvait rien non plus.
    const parIng = ingredients.map((ing) =>
      exists(
        db
          .select({ x: sql`1` })
          .from(I)
          .where(and(eq(cle, R.id), ilike(I.nomRecherche, `%${normaliserPourRecherche(ing)}%`))),
      ),
    );
    const conditions = [
      ...(texte ? [ilike(R.titreRecherche, `%${normaliserPourRecherche(texte)}%`)] : []),
      ...(parIng.length > 0 ? [or(...parIng)!] : []),
    ];
    if (conditions.length === 0) continue;

    const trouvees = await db
      .select({ id: R.id, titre: R.title })
      .from(R)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .limit(MAX_RESULTATS);
    if (trouvees.length === 0) continue;

    const ings = await db
      .select({ r: cle, canonical: I.canonical, nom: I.name })
      .from(I)
      .where(inArray(cle, trouvees.map((t) => t.id)));

    for (const t of trouvees) {
      const siennes = ings.filter((i) => i.r === t.id);
      const couverts = ingredients.filter((d) => siennes.some((i) => i.canonical.includes(d)));
      const manquants = siennes
        .filter((i) => !ingredients.some((d) => i.canonical.includes(d)))
        .map((i) => i.nom);
      lignes.push(
        `- [${src} #${t.id}] ${t.titre} — couvre ${couverts.length}/${ingredients.length || "?"} ; ` +
          (manquants.length === 0
            ? "rien ne manque"
            : `manque ${manquants.length} : ${manquants.slice(0, 8).join(", ")}${manquants.length > 8 ? "…" : ""}`),
      );
    }
  }
  return lignes.length === 0 ? "Aucune recette ne correspond." : lignes.join("\n");
}

async function lireRecette(a: Record<string, unknown>): Promise<string> {
  const id = idValide(a.id);
  if (id === null) return "Identifiant invalide : donne le numéro rendu par la recherche.";
  if (a.source !== "catalogue" && a.source !== "mes-recettes") {
    return "Source invalide : « catalogue » ou « mes-recettes ».";
  }
  const cat = a.source === "catalogue";
  const R = cat ? schema.catalogRecipes : schema.recipes;
  const I = cat ? schema.catalogIngredients : schema.recipeIngredients;
  const cle = cat ? schema.catalogIngredients.catalogRecipeId : schema.recipeIngredients.recipeId;

  const [r] = await db
    .select({ titre: R.title, servings: R.servings, instructions: R.instructions })
    .from(R)
    .where(eq(R.id, id));
  if (!r) return `Aucune recette #${id} dans ${cat ? "le catalogue" : "les recettes de Marc"}.`;

  const ings = await db
    .select({ nom: I.name, qty: I.qty, unit: I.unit, note: I.note })
    .from(I)
    .where(eq(cle, id));

  return [
    `${r.titre} (pour ${r.servings} portions)`,
    "Ingrédients :",
    ...ings.map((i) => `  - ${i.nom} : ${formatQty(i.qty, i.unit)}${i.note ? ` (${i.note})` : ""}`),
    r.instructions ? `Préparation :\n${r.instructions}` : "Préparation : non enregistrée.",
  ].join("\n");
}

async function listerBatchs(): Promise<string> {
  const batchs = await db.select().from(schema.batches).orderBy(desc(schema.batches.createdAt)).limit(MAX_RESULTATS);
  if (batchs.length === 0) return "Aucun batch.";
  const ids = batchs.map((b) => b.id);
  const recettes = await db
    .select({ batchId: schema.batchRecipes.batchId, titre: schema.recipes.title, portions: schema.batchRecipes.portions })
    .from(schema.batchRecipes)
    .innerJoin(schema.recipes, eq(schema.recipes.id, schema.batchRecipes.recipeId))
    .where(inArray(schema.batchRecipes.batchId, ids));
  const articles = await db
    .select({ batchId: schema.shoppingItems.batchId, estCost: schema.shoppingItems.estCost, checked: schema.shoppingItems.checked })
    .from(schema.shoppingItems)
    .where(inArray(schema.shoppingItems.batchId, ids));

  return batchs
    .map((b) => {
      const siennes = recettes.filter((r) => r.batchId === b.id);
      const siens = articles.filter((x) => x.batchId === b.id);
      const total = siens.reduce((s, x) => s + (x.estCost ?? 0), 0);
      const pris = siens.filter((x) => x.checked).length;
      return (
        `- Batch #${b.id} « ${b.name} » — statut : ${b.status} ; ` +
        `${siennes.map((r) => `${r.titre} (${r.portions} portions)`).join(", ") || "aucune recette"} ; ` +
        `épicerie ${pris}/${siens.length} pris, ${formatMontant(total)} estimé`
      );
    })
    .join("\n");
}

async function lireListeEpicerie(a: Record<string, unknown>): Promise<string> {
  const batchId = idValide(a.batchId);
  if (batchId === null) return "Identifiant de batch invalide.";
  const [batch] = await db.select().from(schema.batches).where(eq(schema.batches.id, batchId));
  if (!batch) return `Aucun batch #${batchId}.`;
  const articles = await db
    .select()
    .from(schema.shoppingItems)
    .where(eq(schema.shoppingItems.batchId, batchId));
  if (articles.length === 0) return `Batch « ${batch.name} » : liste vide.`;

  const p = progressionCourses(articles.map((x) => ({ checked: x.checked, estCost: x.estCost })));
  return [
    `Batch « ${batch.name} » — ${p.pris}/${p.total} pris, reste ${formatMontant(p.restantEstime)} estimé${p.montantIncomplet ? "+ (des articles n'ont pas de prix estimé)" : ""}`,
    ...articles.map(
      (x) => `  ${x.checked ? "[pris]" : "[    ]"} #${x.id} ${x.name} — ${formatQty(x.qty, x.unit)}`,
    ),
  ].join("\n");
}

async function creerBatch(a: Record<string, unknown>): Promise<{ texte: string; echec: boolean }> {
  const nom = typeof a.nom === "string" ? a.nom.trim() : "";
  if (!nom) return { texte: "Donne un nom au batch.", echec: true };
  const brut = Array.isArray(a.recettes) ? a.recettes : [];
  const selections: Array<{ recipeId: number; portions: number }> = [];
  for (const r of brut) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    const id = idValide(o.id);
    const portions = idValide(o.portions);
    if (id === null || portions === null) {
      return { texte: "Chaque recette veut un `id` et des `portions` entiers positifs.", echec: true };
    }
    selections.push({ recipeId: id, portions });
  }
  if (selections.length === 0) return { texte: "Choisis au moins une recette.", echec: true };

  // On passe par le TRAVAIL de l'app : ses garde-fous valent pour Claude comme pour Marc.
  const res = await creerBatchInterne({ name: nom, selections });
  if (!res.ok) return { texte: res.error, echec: true };
  return {
    texte:
      `Batch #${res.id} « ${nom} » créé avec ${selections.length} recette(s).` +
      (res.estimationError
        ? ` ⚠️ L'estimation de prix a échoué (${res.estimationError}) : un filet de secours a servi, les prix sont plus grossiers que d'habitude.`
        : ""),
    echec: false,
  };
}

async function ajouterDuCatalogue(a: Record<string, unknown>): Promise<{ texte: string; echec: boolean }> {
  const ids = (Array.isArray(a.ids) ? a.ids : []).map(idValide).filter((x): x is number => x !== null);
  if (ids.length === 0) return { texte: "Donne au moins un identifiant de recette du catalogue.", echec: true };
  const res = await ajouterDuCatalogueInterne(ids);
  if (!res.ok) return { texte: res.error, echec: true };
  // Les chiffres viennent de l'action, pas d'une supposition : « 3 traitées » ne dit pas
  // combien ont VRAIMENT été ajoutées.
  return {
    texte: `${res.added ?? 0} recette(s) ajoutée(s) à la bibliothèque, ${res.skipped ?? 0} déjà présente(s).`,
    echec: false,
  };
}

async function cocherArticle(a: Record<string, unknown>): Promise<{ texte: string; echec: boolean }> {
  const id = idValide(a.articleId);
  if (id === null) return { texte: "Identifiant d'article invalide.", echec: true };
  if (typeof a.pris !== "boolean") return { texte: "`pris` doit être true ou false.", echec: true };
  const res = await cocherArticleInterne(id, a.pris);
  if (!res.ok) return { texte: res.error, echec: true };
  return { texte: `Article #${id} marqué ${a.pris ? "pris" : "à prendre"}.`, echec: false };
}

/**
 * Exécute un outil. Une panne est RENDUE comme résultat d'outil (`isError`), jamais lancée :
 * le modèle peut alors le dire ou reformuler, là où une exception couperait la conversation.
 */
export async function executerOutilMcp(
  nom: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    switch (nom) {
      case "batchchef_chercher_recettes":
        return resultatOutil(borner(await chercherRecettes(args)));
      case "batchchef_lire_recette":
        return resultatOutil(borner(await lireRecette(args)));
      case "batchchef_lister_batchs":
        return resultatOutil(borner(await listerBatchs()));
      case "batchchef_lire_liste_epicerie":
        return resultatOutil(borner(await lireListeEpicerie(args)));
      case "batchchef_creer_batch": {
        const r = await creerBatch(args);
        return resultatOutil(r.texte, r.echec);
      }
      case "batchchef_ajouter_recette_du_catalogue": {
        const r = await ajouterDuCatalogue(args);
        return resultatOutil(r.texte, r.echec);
      }
      case "batchchef_cocher_article": {
        const r = await cocherArticle(args);
        return resultatOutil(r.texte, r.echec);
      }
      default:
        return resultatOutil(`Outil inconnu : ${nom}.`, true);
    }
  } catch (err) {
    return resultatOutil(
      `L'outil ${nom} a échoué : ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  }
}
