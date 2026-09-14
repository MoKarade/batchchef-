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

export interface RecetteSemaine {
  catalogRecipeId: number;
  titre: string;
  imageUrl: string | null;
  prepMinutes: number | null;
  cuissonMinutes: number | null;
  position: number;
  /** Type effectif (correction de Marc, sinon estimation). `null` = non déterminé. */
  type: TypePlat | null;
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
