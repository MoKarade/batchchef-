// lib/semaineDb.ts — la moitié IMPURE de la proposition hebdomadaire (SEM-02) : lire la
// semaine en base, et la fabriquer si elle n'existe pas encore.
//
// ⚠️ Module ORDINAIRE, jamais `"use server"` : dans un fichier de Server Actions, TOUTE
// fonction async exportée devient un point d'entrée HTTP. Ce qui est appelé par un Server
// Component se lit ici ; ce qui ÉCRIT sur un geste de Marc vit dans `lib/actions.ts`, avec
// son `requireSession`.
//
// La décision de QUOI proposer est dans `lib/semaine.ts`, pur et testé. Ici, il n'y a que
// des requêtes et une transaction.

import { and, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  COMPOSITION,
  RECETTES_PAR_SEMAINE,
  TAILLE_PRESELECTION,
  choisirQuatre,
  estCommun,
  semaineISO,
  type CandidateSemaine,
} from "@/lib/semaine";
import { estRepas, estTypePlat, type TypePlat } from "@/lib/typePlat";
import { positionEnBase } from "@/lib/assistant/protocole";
import { aggregateShoppingList, fillMissingCosts } from "@/lib/aggregate";
import { ecarterIngredientsDeFond } from "@/lib/ingredientsDeFond";
import { estimateShoppingCosts } from "@/lib/llm";

export interface RecetteSemaine {
  catalogRecipeId: number;
  titre: string;
  imageUrl: string | null;
  prepMinutes: number | null;
  cuissonMinutes: number | null;
  position: number;
  /** Type effectif (correction de Marc, sinon estimation). `null` = non déterminé. */
  type: TypePlat | null;
  /** Difficulté estimée, 1 à 5 (SEM-05). `null` = trop peu de signaux pour oser une note. */
  difficulte: number | null;
}

export interface SemaineAffichee {
  /** « 2026-W38 ». */
  semaine: string;
  recettes: RecetteSemaine[];
  /** Vrai quand la proposition vient d'être fabriquée (utile aux tests et aux logs). */
  fabriquee: boolean;
}

/** Les recettes du catalogue que Marc a DÉJÀ mises dans un batch — on ne les repropose pas. */
async function dejaCuisinees(): Promise<number[]> {
  const rows = await db
    .selectDistinct({ id: schema.catalogRecipes.id })
    .from(schema.catalogRecipes)
    .innerJoin(schema.recipes, eq(schema.recipes.sourceUrl, schema.catalogRecipes.sourceUrl))
    .innerJoin(schema.batchRecipes, eq(schema.batchRecipes.recipeId, schema.recipes.id));
  return rows.map((r) => r.id);
}

/**
 * Les candidates : un échantillon DÉTERMINISTE du catalogue, avec leurs ingrédients
 * distinctifs. `md5(semaine || id)` donne le même échantillon toute la semaine, et un autre
 * la suivante — sans rien persister pour ça.
 */
async function candidates(graine: string, exclues: readonly number[]): Promise<CandidateSemaine[]> {
  // ⚠️ Le type EFFECTIF, pas l'estimation : une recette que Marc a corrigée doit être tirée
  // sous sa nouvelle famille. Et on ne présélectionne QUE ce qui peut être proposé (plats,
  // soupes, salades, desserts) — tirer des sauces pour les jeter ensuite gaspillerait la
  // présélection et laisserait des places vides.
  const typeSql = sql<string | null>`coalesce(${schema.typeCorrections.type}, ${schema.catalogRecipes.typeEstime})`;
  const proposable = sql`coalesce(${schema.typeCorrections.type}, ${schema.catalogRecipes.typeEstime}) in ('plat','soupe','salade','dessert')`;
  const base = db
    .select({
      id: schema.catalogRecipes.id,
      titre: schema.catalogRecipes.title,
      prepMinutes: schema.catalogRecipes.prepMinutes,
      cuissonMinutes: schema.catalogRecipes.cuissonMinutes,
      type: typeSql,
    })
    .from(schema.catalogRecipes)
    .leftJoin(schema.typeCorrections, eq(schema.typeCorrections.sourceUrl, schema.catalogRecipes.sourceUrl));
  const pre = await base
    .where(
      exclues.length > 0
        ? and(proposable, notInArray(schema.catalogRecipes.id, [...exclues]))
        : proposable,
    )
    .orderBy(sql`md5(${graine} || ${schema.catalogRecipes.id}::text)`)
    .limit(TAILLE_PRESELECTION);
  if (pre.length === 0) return [];

  const ids = pre.map((r) => r.id);
  const ings = await db
    .select({
      recette: schema.catalogIngredients.catalogRecipeId,
      canonical: schema.catalogIngredients.canonical,
    })
    .from(schema.catalogIngredients)
    .where(inArray(schema.catalogIngredients.catalogRecipeId, ids));

  const canoniques = [...new Set(ings.map((i) => i.canonical))];
  // La fréquence se mesure sur TOUT le catalogue, pas sur l'échantillon : « distinctif » veut
  // dire rare dans le corpus, pas rare parmi deux cents recettes tirées au hasard.
  const [total] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.catalogRecipes);
  const frequences =
    canoniques.length === 0
      ? []
      : await db
          .select({
            canonical: schema.catalogIngredients.canonical,
            n: sql<number>`count(distinct ${schema.catalogIngredients.catalogRecipeId})::int`,
          })
          .from(schema.catalogIngredients)
          .where(inArray(schema.catalogIngredients.canonical, canoniques))
          .groupBy(schema.catalogIngredients.canonical);

  const totalRecettes = total?.n ?? 0;
  const communs = new Set(
    frequences.filter((f) => estCommun(f.n, totalRecettes)).map((f) => f.canonical),
  );

  return pre.map((r) => ({
    id: r.id,
    titre: r.titre,
    prepMinutes: r.prepMinutes,
    cuissonMinutes: r.cuissonMinutes,
    type: estTypePlat(r.type) ? r.type : null,
    distinctifs: [
      ...new Set(
        ings.filter((i) => i.recette === r.id && !communs.has(i.canonical)).map((i) => i.canonical),
      ),
    ],
  }));
}

/**
 * Relit la proposition persistée d'une semaine, jointe aux recettes du catalogue.
 *
 * ⚠️ EXPORTÉE POUR LE HUB, ET C'EST EXACTEMENT POURQUOI ELLE EST SÉPARÉE DE
 * `semaineCourante`. Celle-ci FABRIQUE la proposition quand elle manque, avec un
 * `delete` + `insert` dans une transaction. Un `GET /api/hub/summary` ne doit rien écrire :
 * le hub interroge toutes les ~15 s tant qu'un onglet est ouvert, et son horloge toutes les
 * 30 min sans personne devant. Appeler `semaineCourante` depuis là fabriquerait la semaine
 * de Marc à l'insu de Marc — et le `delete … where semaine <> …` effacerait la précédente.
 * Le hub LIT, il ne décide pas de la semaine.
 */
export async function lireSemaine(semaine: string): Promise<RecetteSemaine[]> {
  const rows = await db
    .select({
      catalogRecipeId: schema.weekPicks.catalogRecipeId,
      position: schema.weekPicks.position,
      titre: schema.catalogRecipes.title,
      imageUrl: schema.catalogRecipes.imageUrl,
      prepMinutes: schema.catalogRecipes.prepMinutes,
      cuissonMinutes: schema.catalogRecipes.cuissonMinutes,
      type: sql<string | null>`coalesce(${schema.typeCorrections.type}, ${schema.catalogRecipes.typeEstime})`,
      difficulte: schema.catalogRecipes.difficulteEstimee,
    })
    .from(schema.weekPicks)
    .innerJoin(schema.catalogRecipes, eq(schema.catalogRecipes.id, schema.weekPicks.catalogRecipeId))
    .leftJoin(schema.typeCorrections, eq(schema.typeCorrections.sourceUrl, schema.catalogRecipes.sourceUrl))
    .where(eq(schema.weekPicks.semaine, semaine))
    .orderBy(schema.weekPicks.position);
  return rows.map((r) => ({ ...r, type: estTypePlat(r.type) ? r.type : null }));
}

/**
 * La proposition de la semaine. La fabrique si elle n'existe pas encore.
 *
 * ⚠️ Deux onglets ouverts le même lundi peuvent entrer ici en même temps. L'écriture est donc
 * gardée par la contrainte d'unicité `(semaine, position)` : le perdant échoue, et on relit
 * ce que le gagnant a écrit plutôt que de fabriquer une seconde proposition.
 */
export async function semaineCourante(maintenant: Date = new Date()): Promise<SemaineAffichee> {
  const semaine = semaineISO(maintenant);
  const existante = await lireSemaine(semaine);
  if (existante.length > 0) return { semaine, recettes: existante, fabriquee: false };

  const exclues = await dejaCuisinees();
  const tirage = choisirQuatre(await candidates(semaine, exclues), exclues, semaine);
  if (tirage.recettes.length === 0) return { semaine, recettes: [], fabriquee: false };

  const lignes = tirage.recettes.map((r, position) => ({
    semaine,
    catalogRecipeId: r.id,
    position,
  }));
  try {
    // Une seule semaine vivante (choix de Marc) : l'ancienne part dans la MÊME transaction
    // que l'écriture de la nouvelle, sinon une coupure entre les deux laisserait l'app sans
    // proposition du tout.
    await db.batch([
      db.delete(schema.weekPicks).where(ne(schema.weekPicks.semaine, semaine)),
      db.insert(schema.weekPicks).values(lignes),
    ]);
  } catch (err) {
    // Deux causes possibles, et elles ne se ressemblent pas : la course perdue contre un
    // autre onglet (la proposition du gagnant est là, on la sert), ou une vraie panne de
    // base. ⚠️ On ne rend JAMAIS la seconde comme « pas de proposition » : on relaie la
    // cause, sinon une base en panne s'affiche comme un catalogue vide.
    const apres = await lireSemaine(semaine).catch(() => []);
    if (apres.length > 0) return { semaine, recettes: apres, fabriquee: false };
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`La proposition de la semaine n'a pas pu être enregistrée : ${cause}`);
  }
  return { semaine, recettes: await lireSemaine(semaine), fabriquee: true };
}

export interface PrixSemaine {
  /** En cents. */
  cents: number;
  /** "llm" = estimé ingrédient par ingrédient, comme le batch. "filet" = tarif forfaitaire. */
  methode: "llm" | "filet";
  /** Ingrédients écartés de la liste d'épicerie (sel, poivre, eau) — comme pour un batch. */
  ecartes: string[];
}

/** L'empreinte de la composition : si elle change, le prix ne décrit plus cette semaine. */
function signatureDe(recettes: ReadonlyArray<{ catalogRecipeId: number }>): string {
  return recettes
    .map((r) => r.catalogRecipeId)
    .slice()
    .sort((a, b) => a - b)
    .join("-");
}

/**
 * Le prix estimé de la semaine (SEM-05), calculé UNE fois par composition et mémorisé.
 *
 * ⚠️ Il passe par les MÊMES fonctions que le batch (`aggregateShoppingList`,
 * `ecarterIngredientsDeFond`, `estimateShoppingCosts`, `fillMissingCosts`) et sur les MÊMES
 * portions (celles de la recette). Deux implémentations d'une même règle, c'est une règle et
 * demie : Marc verrait un prix avant de monter le batch, un autre après, pour exactement les
 * mêmes courses.
 *
 * ⚠️ Un échec d'appel ne fait PAS disparaître le prix — le filet déterministe donne un
 * chiffre à tout — mais il change `methode`, et l'écran le dit. Un tarif forfaitaire présenté
 * comme une estimation par ingrédient serait le défaut que le reste de l'app s'interdit.
 */
export async function prixSemaine(
  semaine: string,
  recettes: ReadonlyArray<{ catalogRecipeId: number }>,
): Promise<PrixSemaine | null> {
  if (recettes.length === 0) return null;
  const signature = signatureDe(recettes);

  const [connu] = await db
    .select()
    .from(schema.weekEstimations)
    .where(eq(schema.weekEstimations.semaine, semaine));
  if (connu && connu.signature === signature) {
    return {
      cents: connu.prixCents,
      methode: connu.methode === "llm" ? "llm" : "filet",
      ecartes: [],
    };
  }

  const ids = recettes.map((r) => r.catalogRecipeId);
  const fiches = await db
    .select({ id: schema.catalogRecipes.id, servings: schema.catalogRecipes.servings })
    .from(schema.catalogRecipes)
    .where(inArray(schema.catalogRecipes.id, ids));
  const lignes = await db
    .select({
      recette: schema.catalogIngredients.catalogRecipeId,
      name: schema.catalogIngredients.name,
      canonical: schema.catalogIngredients.canonical,
      qty: schema.catalogIngredients.qty,
      unit: schema.catalogIngredients.unit,
    })
    .from(schema.catalogIngredients)
    .where(inArray(schema.catalogIngredients.catalogRecipeId, ids));
  if (fiches.length === 0 || lignes.length === 0) return null;

  // Mêmes portions que `creerBatchDepuisSemaine` : celles de la recette, soit 1×.
  const agrege = aggregateShoppingList(
    fiches.map((f) => ({
      servings: f.servings,
      portions: f.servings,
      ingredients: lignes
        .filter((l) => l.recette === f.id)
        .map((l) => ({ name: l.name, canonical: l.canonical, qty: l.qty, unit: l.unit })),
    })),
  );
  const { aAcheter, deFond } = ecarterIngredientsDeFond(agrege);

  let methode: "llm" | "filet" = "llm";
  let bruts: Array<number | null> = new Array(aAcheter.length).fill(null);
  try {
    bruts = await estimateShoppingCosts(aAcheter);
  } catch {
    // ⚠️ Avalé DÉLIBÉRÉMENT, et le silence ne l'est pas : la panne devient `methode: "filet"`,
    // que l'écran affiche. Laisser remonter l'erreur ferait disparaître le prix entier pour
    // une indisponibilité passagère de l'API.
    methode = "filet";
  }
  const cents = fillMissingCosts(aAcheter, bruts).reduce((t, c) => t + Math.round(c * 100), 0);

  // ⚠️ L'écriture n'est PAS une condition d'affichage : une base qui refuse la mémorisation
  // ne doit pas effacer un prix qu'on vient de calculer et de payer.
  try {
    await db
      .insert(schema.weekEstimations)
      .values({ semaine, signature, prixCents: cents, methode })
      .onConflictDoUpdate({
        target: schema.weekEstimations.semaine,
        set: { signature, prixCents: cents, methode, calculeLe: new Date() },
      });
  } catch {
    // Le prix reste juste ; seule sa mémorisation a échoué, et le prochain affichage
    // relancera le calcul.
  }

  return { cents, methode, ecartes: deFond.map((e) => e.name) };
}

/**
 * Remplace UNE recette de la semaine par une autre, tirée du catalogue.
 *
 * ⚠️ La remplaçante ne doit répéter aucune des trois qui restent — sinon « remplacer » ne
 * servirait qu'à tomber sur un plat presque identique. On réutilise donc `choisirQuatre`
 * avec les autres positions en exclusion, plutôt que d'écrire une seconde règle de variété
 * à côté : deux implémentations d'une même règle, c'est une règle et demie.
 */
export async function remplacerPosition(
  position: number,
  maintenant: Date = new Date(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(position) || position < 0 || position >= RECETTES_PAR_SEMAINE) {
    return { ok: false, error: "Position hors de la semaine." };
  }
  const semaine = semaineISO(maintenant);
  const actuelles = await lireSemaine(semaine);
  if (actuelles.length === 0) return { ok: false, error: "Aucune proposition cette semaine." };
  const cible = actuelles.find((r) => r.position === position);
  if (!cible) return { ok: false, error: "Position introuvable dans la semaine." };

  const gardees = actuelles.filter((r) => r.position !== position).map((r) => r.catalogRecipeId);
  // ⚠️ La place a un RÔLE : remplacer le dessert doit rendre un dessert, remplacer un plat un
  // plat. Sans ça, « Remplacer » sur la quatrième carte transformerait la semaine en quatre
  // plats sans que rien ne le dise.
  const roleAttendu = (p: number): ((t: TypePlat | null) => boolean) =>
    p >= COMPOSITION.repas ? (t) => t === "dessert" : estRepas;
  const admis = roleAttendu(position);
  const exclues = [...new Set([...(await dejaCuisinees()), ...gardees, ...actuelles.map((r) => r.catalogRecipeId)])];
  // La graine change à chaque remplacement, sinon le bouton rendrait toujours la même.
  const graine = `${semaine}:${position}:${Date.now()}`;
  const dispo = await candidates(graine, exclues);
  const distinctifsGardes = await db
    .select({ canonical: schema.catalogIngredients.canonical })
    .from(schema.catalogIngredients)
    .where(
      gardees.length > 0
        ? inArray(schema.catalogIngredients.catalogRecipeId, gardees)
        : sql`false`,
    );
  const pris = new Set(distinctifsGardes.map((d) => d.canonical));
  const compatibles = dispo.filter((c) => admis(c.type));
  const remplacante =
    compatibles.find((c) => c.distinctifs.length > 0 && !c.distinctifs.some((d) => pris.has(d))) ??
    compatibles[0];
  if (!remplacante) {
    return {
      ok: false,
      error:
        position >= COMPOSITION.repas
          ? "Plus aucun dessert à proposer."
          : "Plus aucun plat à proposer.",
    };
  }

  await db
    .update(schema.weekPicks)
    .set({ catalogRecipeId: remplacante.id })
    .where(and(eq(schema.weekPicks.semaine, semaine), eq(schema.weekPicks.position, position)));
  return { ok: true };
}

/** Le rôle qu'une place attend : les trois premières portent un repas, la quatrième un dessert. */
export function roleDeLaPlace(position: number): "repas" | "dessert" {
  return position >= COMPOSITION.repas ? "dessert" : "repas";
}

export interface ApercuPlacement {
  /** La recette proposée. */
  titre: string;
  type: TypePlat | null;
  /** Ce qui occupe la place aujourd'hui — Marc doit voir ce qu'il remplace. */
  titreActuel: string;
  /** `true` quand la recette ne tient pas le rôle de la place. */
  casseComposition: boolean;
  roleAttendu: "repas" | "dessert";
}

/**
 * Ce qu'une proposition de l'assistant ferait, AVANT de la faire (SEM-03).
 *
 * ⚠️ Marc a tranché que la composition « 3 plats + 1 dessert » peut être contournée s'il le
 * demande explicitement — et le clic EST la demande explicite, à condition que la carte
 * annonce ce qu'elle casse. C'est ce que cet aperçu sert à écrire à l'écran : sans lui, le
 * bouton appliquerait un dessert à une place de plat sans que rien ne le dise.
 */
export async function apercuPlacement(
  place: number,
  catalogRecipeId: number,
  maintenant: Date = new Date(),
): Promise<ApercuPlacement | { erreur: string }> {
  const position = positionEnBase(place);
  if (position === null) return { erreur: "Cette place n'existe pas dans la semaine." };

  const semaine = semaineISO(maintenant);
  const actuelles = await lireSemaine(semaine);
  const actuelle = actuelles.find((r) => r.position === position);
  if (!actuelle) return { erreur: "Aucune proposition à cette place cette semaine." };

  const [cible] = await db
    .select({
      titre: schema.catalogRecipes.title,
      type: sql<string | null>`coalesce(${schema.typeCorrections.type}, ${schema.catalogRecipes.typeEstime})`,
    })
    .from(schema.catalogRecipes)
    .leftJoin(schema.typeCorrections, eq(schema.typeCorrections.sourceUrl, schema.catalogRecipes.sourceUrl))
    .where(eq(schema.catalogRecipes.id, catalogRecipeId));
  // ⚠️ On ne fait JAMAIS confiance à l'identifiant du marqueur : il vient d'un modèle.
  if (!cible) return { erreur: "Cette recette n'existe pas dans le catalogue." };

  const type = estTypePlat(cible.type) ? cible.type : null;
  const roleAttendu = roleDeLaPlace(position);
  const tientLeRole = roleAttendu === "dessert" ? type === "dessert" : estRepas(type);

  return {
    titre: cible.titre,
    type,
    titreActuel: actuelle.titre,
    casseComposition: !tientLeRole,
    roleAttendu,
  };
}

/**
 * Pose une recette PRÉCISE à une place de la semaine (SEM-03).
 *
 * ⚠️ Tout est revalidé ICI — la place, l'existence de la recette, l'existence de la semaine.
 * Le marqueur qui a produit le bouton vient d'un modèle, et le bouton lui-même est
 * atteignable sans passer par le chat : une Server Action est un point d'entrée POST.
 *
 * ⚠️ Le rôle n'est PAS un refus (arbitrage de Marc, 14/09) : il peut mettre deux desserts
 * s'il le demande. Ce qui est non négociable, c'est que la carte l'ait DIT avant le clic.
 */
export async function placerRecette(
  place: number,
  catalogRecipeId: number,
  maintenant: Date = new Date(),
): Promise<{ ok: true; titre: string } | { ok: false; error: string }> {
  const position = positionEnBase(place);
  if (position === null) return { ok: false, error: "Cette place n'existe pas dans la semaine." };

  const apercu = await apercuPlacement(place, catalogRecipeId, maintenant);
  if ("erreur" in apercu) return { ok: false, error: apercu.erreur };

  const semaine = semaineISO(maintenant);
  await db
    .update(schema.weekPicks)
    .set({ catalogRecipeId })
    .where(and(eq(schema.weekPicks.semaine, semaine), eq(schema.weekPicks.position, position)));
  return { ok: true, titre: apercu.titre };
}

/**
 * Retire les quatre recettes et en propose quatre autres (SEM-03, demande de Marc).
 *
 * ⚠️ La graine change à chaque appel. `semaineCourante` tire sur `semaine` — déterministe
 * par conception, pour que la semaine ne bouge pas d'un affichage à l'autre. Rejouer avec
 * cette graine-là rendrait exactement les quatre mêmes recettes, et le bouton aurait l'air
 * cassé.
 *
 * ⚠️ Écriture ATOMIQUE : le retrait et la pose sont dans la même transaction. Une coupure
 * entre les deux laisserait Marc sans aucune proposition — pire que l'ancienne.
 */
export async function regenererSemaine(
  maintenant: Date = new Date(),
): Promise<{ ok: true; recettes: number } | { ok: false; error: string }> {
  const semaine = semaineISO(maintenant);
  const exclues = await dejaCuisinees();
  const graine = `${semaine}:regen:${Date.now()}`;
  const tirage = choisirQuatre(await candidates(graine, exclues), exclues, graine);
  if (tirage.recettes.length === 0) {
    return { ok: false, error: "Plus aucune recette à proposer pour l'instant." };
  }
  const lignes = tirage.recettes.map((r, position) => ({
    semaine,
    catalogRecipeId: r.id,
    position,
  }));
  try {
    await db.batch([
      db.delete(schema.weekPicks).where(eq(schema.weekPicks.semaine, semaine)),
      db.insert(schema.weekPicks).values(lignes),
    ]);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `La nouvelle proposition n'a pas pu être enregistrée : ${cause}` };
  }
  return { ok: true, recettes: lignes.length };
}
