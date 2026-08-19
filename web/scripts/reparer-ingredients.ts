// Répare les ingrédients hérités du catalogue V3 : les NOMS abîmés et les UNITÉS fausses.
//
// Lancé automatiquement par `vercel-build`, avant `next build` : exigence de Marc, il ne doit
// jamais avoir de commande à taper. La passe est IDEMPOTENTE et ne fait rien quand il n'y a
// plus rien à corriger, donc la rejouer à chaque déploiement ne coûte que sa lecture du seed.
//
// DEUX DÉGÂTS, UNE SEULE CAUSE : l'extraction d'unité de l'app V3 ne bornait pas ses mots.
// Elle a reconnu `g` dans « gousses », `cl` dans « clous », `l` dans « lamelles » —
// et a donc RETIRÉ ces lettres du nom tout en enregistrant une unité de MASSE là où le texte
// parlait de PIÈCES. Le second défaut est le plus grave : « Gousses D'Ail — 3 g » fait
// acheter une demi-gousse quand il en faut trois.
//
// ⚠️ LA SOURCE DE VÉRITÉ est `data/batchchef.seed.db` (`recipe_ingredient.raw_text`), intact.
// Rien ne permet de reconstituer « gousse » depuis `unit='g', qty=0.25` : l'information n'est
// pas dans la donnée de production. C'est pour ça que cette passe lit le seed, contrairement
// à la réparation des noms d'ING-03 qui se suffisait d'un retrait de préfixe.
//
// ⚠️ TROIS tables : le catalogue est la source, mais `ajouterDuCatalogue` copie vers la
// bibliothèque de Marc, et la création d'un batch recopie vers la liste d'épicerie.
//
// ⚠️ ON S'ABSTIENT DÈS QU'IL Y A DOUTE. « 200 g de gingembre » est légitime ; convertir
// aveuglément en ferait 200 unités. La correction n'a lieu que si TOUTES les lignes source
// d'un ingrédient s'accordent (cf. `uniteCorrigee`), et si deux ingrédients du seed
// retombent sur la même clé de production avec des corrections DIFFÉRENTES, on ne touche ni
// l'un ni l'autre.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import initSqlJs from "sql.js";
import { db, schema } from "../lib/db";
import { aggregateShoppingList } from "../lib/aggregate";
import { ecarterIngredientsDeFond } from "../lib/ingredientsDeFond";
import { reparerCanonique, reparerNom } from "../lib/ingredientsNoms";
import { nomRestaure, nomSansPrepositionFinale, uniteCorrigee } from "../lib/ingredientsSource";
import { quantiteCorrigee, rendementRecette } from "../lib/quantitesSource";
import { normalizeQty } from "../lib/units";

const require = createRequire(import.meta.url);
const SEED = path.resolve(process.cwd(), "data", "batchchef.seed.db");

interface Correction {
  /** `null` = les sources ne s'accordent pas sur le nom : on n'y touche pas. */
  nom: string | null;
  /** `null` = pas de correction d'unité (rien à corriger, ou sources en désaccord). */
  unite: "unite" | null;
}

/** Construit, depuis le seed, ce que chaque clé de PRODUCTION devrait porter. */
type Sqlite = Awaited<ReturnType<typeof ouvrirSeed>>;

async function ouvrirSeed() {
  const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
  return new SQL.Database(readFileSync(SEED));
}

function corrections(sqlite: Sqlite): Map<string, Correction> {

  const sources = new Map<number, string[]>();
  const stmtSrc = sqlite.prepare(
    "SELECT ingredient_master_id AS m, raw_text AS r FROM recipe_ingredient WHERE raw_text IS NOT NULL AND ingredient_master_id IS NOT NULL",
  );
  while (stmtSrc.step()) {
    const row = stmtSrc.getAsObject() as { m: number; r: string };
    const liste = sources.get(row.m);
    if (liste) liste.push(row.r);
    else sources.set(row.m, [row.r]);
  }
  stmtSrc.free();

  const map = new Map<string, Correction>();
  const conflitsNom = new Set<string>();
  const conflitsUnite = new Set<string>();
  const stmt = sqlite.prepare(
    "SELECT id AS i, display_name_fr AS n, canonical_name AS c FROM ingredient_master WHERE display_name_fr IS NOT NULL AND canonical_name IS NOT NULL",
  );
  while (stmt.step()) {
    const { i, n, c } = stmt.getAsObject() as { i: number; n: string; c: string };
    const src = sources.get(i) ?? [];
    if (src.length === 0) continue;

    // La clé telle que la PRODUCTION la porte aujourd'hui : le seed est abîmé, mais ING-03
    // a déjà réparé une partie des clés en base. On rejoue la même transformation.
    const cleProd = reparerCanonique(c);
    // Le nom tel que la production le porte : ING-03 d'abord, puis restauration des lettres.
    const nom = nomSansPrepositionFinale(nomRestaure(reparerNom(n), src));
    const unite = uniteCorrigee("g", src) ?? uniteCorrigee("ml", src);

    // ⚠️ Le conflit se juge CHAMP PAR CHAMP, jamais en bloc.
    //
    // Vécu : deux entrées du seed retombent sur `gousses_d'ail` et ne divergent que par la
    // CASSE du nom. Une abstention globale écartait donc aussi la correction d'UNITÉ — et
    // c'était le cas le plus fréquent du corpus (1 482 lignes) qui passait à travers. Un
    // désaccord sur le nom n'apprend rien sur l'unité : les deux se décident séparément.
    const dejaVu = map.get(cleProd);
    if (!dejaVu) {
      map.set(cleProd, { nom, unite });
      continue;
    }
    if (dejaVu.nom !== nom) conflitsNom.add(cleProd);
    if (dejaVu.unite !== unite) conflitsUnite.add(cleProd);
  }
  stmt.free();

  // On neutralise SEULEMENT le champ en désaccord, en gardant l'autre.
  for (const k of conflitsNom) {
    const c = map.get(k);
    if (c) map.set(k, { nom: null, unite: c.unite });
  }
  for (const k of conflitsUnite) {
    const c = map.get(k);
    if (c) map.set(k, { nom: c.nom, unite: null });
  }
  console.log(
    `[ingr] désaccords entre sources : ${conflitsNom.size} sur le nom, ${conflitsUnite.size} sur l'unité ` +
      "(le champ en désaccord est laissé tel quel, l'autre est corrigé).",
  );
  return map;
}

type Table = typeof schema.catalogIngredients;

async function appliquer(libelle: string, table: Table, map: Map<string, Correction>): Promise<number> {
  const couples = await db
    .selectDistinct({ canonical: table.canonical, name: table.name, unit: table.unit })
    .from(table);

  let lignes = 0;
  let valeurs = 0;
  for (const c of couples) {
    const corr = map.get(c.canonical);
    // ⚠️ Le nettoyage de la préposition finale ne consulte AUCUNE source : il s'applique
    // donc au nom présent, indépendamment de la carte. Le faire passer par elle le rendait
    // inopérant sur les clés en conflit — et « huile » en est une, soit 163 des 222 lignes
    // concernées. Une correction qui n'a pas besoin d'une source ne doit pas dépendre
    // d'un accord entre sources.
    const nom = nomSansPrepositionFinale(corr?.nom ?? c.name);
    // ⚠️ On ne corrige l'unité QUE si elle est aujourd'hui une mesure de masse/volume.
    // `unite` et `null` sont laissés tels quels : on répare une erreur, on n'impose rien.
    const unite = corr?.unite && (c.unit === "g" || c.unit === "ml") ? corr.unite : c.unit;
    if (nom === c.name && unite === c.unit) continue;
    const res = await db
      .update(table)
      .set({ name: nom, unit: unite })
      .where(sql`${table.canonical} = ${c.canonical} AND ${table.name} = ${c.name}`)
      .returning({ id: table.id });
    valeurs += 1;
    lignes += res.length;
  }
  // Tracé MÊME à zéro : « 0 » et l'absence de ligne disent des choses opposées, et c'est ce
  // qui permet de distinguer « déjà corrigé » de « jamais tourné ».
  console.log(`[ingr] ${libelle} : ${valeurs} valeur(s) distincte(s), ${lignes} ligne(s) mise(s) à jour.`);
  return lignes;
}


// ── QUANTITÉS ────────────────────────────────────────────────────────────────────────────
//
// Le nom et l'unité se corrigent par CLÉ d'ingrédient (« gousses d'ail » se répare partout
// de la même façon). La quantité, non : elle appartient à la LIGNE. « 1/2 kg de viande » et
// « 2 kg de viande » sont le même ingrédient et deux quantités. Il faut donc rapparier chaque
// ligne de production à sa ligne source — par l'URL de la recette, puis par la clé.
//
// ⚠️ AMBIGUÏTÉ ASSUMÉE : 1 266 recettes du seed citent deux fois le même ingrédient (deux
// lignes, deux textes). Elles retombent sur UNE clé en production. Quand les deux lignes
// n'attendent pas la même quantité, on ne touche à aucune des deux — sinon on écraserait
// l'une par l'autre sans rien pour choisir.

interface QuantiteAttendue {
  qty: number | null;
  /** Texte source à garder en note quand la quantité disparaît ET qu'elle portait un chiffre. */
  note: string | null;
}

/** `${sourceUrl}\u0000${clé}` → attendu, ou `null` quand deux lignes source se contredisent. */
function quantitesAttendues(sqlite: Sqlite): Map<string, QuantiteAttendue | null> {
  const parRecette = new Map<number, Array<{ raw: string; qpp: number | null; unit: string | null; nom: string; canon: string }>>();
  const stmt = sqlite.prepare(
    `SELECT ri.recipe_id AS r, ri.raw_text AS raw, ri.quantity_per_portion AS q, ri.unit AS u,
            COALESCE(im.display_name_fr, ri.raw_text) AS nom,
            COALESCE(im.canonical_name, LOWER(ri.raw_text)) AS canon
     FROM recipe_ingredient ri LEFT JOIN ingredient_master im ON im.id = ri.ingredient_master_id`,
  );
  while (stmt.step()) {
    const row = stmt.getAsObject() as { r: number; raw: string | null; q: number | null; u: string | null; nom: string | null; canon: string | null };
    const liste = parRecette.get(row.r) ?? [];
    liste.push({ raw: String(row.raw ?? ""), qpp: row.q, unit: row.u, nom: String(row.nom ?? ""), canon: String(row.canon ?? "") });
    parRecette.set(row.r, liste);
  }
  stmt.free();

  const urls = new Map<number, { url: string; servings: number }>();
  const stmtR = sqlite.prepare("SELECT id AS i, marmiton_url AS u, servings AS s FROM recipe WHERE marmiton_url IS NOT NULL");
  while (stmtR.step()) {
    const row = stmtR.getAsObject() as { i: number; u: string; s: number | null };
    urls.set(row.i, { url: row.u, servings: Number(row.s) > 0 ? Number(row.s) : 1 });
  }
  stmtR.free();

  const map = new Map<string, QuantiteAttendue | null>();
  let recettesSansRendement = 0;
  for (const [rid, lignes] of parRecette) {
    const recette = urls.get(rid);
    if (!recette) continue;
    const rendement = rendementRecette(lignes.map((l) => ({ raw: l.raw, qpp: l.qpp })));
    if (rendement === null) recettesSansRendement += 1;
    for (const l of lignes) {
      const verdict = quantiteCorrigee({ raw: l.raw, qpp: l.qpp }, rendement);
      const qtySource = verdict.corriger ? verdict.qpp : l.qpp;
      const norm = normalizeQty(qtySource, l.unit, l.raw, l.nom);
      const qty = norm.qty === null ? null : Math.round(norm.qty * recette.servings * 100) / 100;
      // La note ne recopie le texte source que s'il portait un CHIFFRE qu'on vient de retirer :
      // « Thon — au goût — 200 g de thon » informe, « Huile — au goût — huile » est du bruit.
      const note = qty === null && /\d/.test(l.raw) ? l.raw.slice(0, 200) : null;
      const cle = `${recette.url}\u0000${reparerCanonique(l.canon.toLowerCase().trim())}`;
      const deja = map.get(cle);
      if (deja === undefined) { map.set(cle, { qty, note }); continue; }
      if (deja === null) continue;
      if (deja.qty !== qty) map.set(cle, null);
    }
  }
  const ambigues = [...map.values()].filter((v) => v === null).length;
  console.log(
    `[ingr] quantités : ${map.size} ligne(s) de référence · ${ambigues} clé(s) ambiguë(s) laissée(s) intacte(s) ` +
      `· ${recettesSansRendement} recette(s) au rendement irrécupérable (quantités rendues « au goût »).`,
  );
  return map;
}

/**
 * Écrit par paquets de 400 : 13 000 `UPDATE` un par un tiendraient le build plusieurs
 * minutes sur une base servie en HTTP. Les casts explicites sont nécessaires — une colonne
 * de `VALUES` dont toutes les lignes sont nulles n'a aucun type inférable.
 *
 * `COALESCE(v.note, t.note)` : on POSE une note, on n'en efface jamais une.
 */
async function ecrireQuantites(
  nomTable: string,
  lignes: Array<{ id: number; qty: number | null; note: string | null }>,
): Promise<number> {
  const PAQUET = 400;
  let ecrites = 0;
  for (let i = 0; i < lignes.length; i += PAQUET) {
    const paquet = lignes.slice(i, i + PAQUET);
    const valeurs = paquet.map((l) => sql`(${l.id}::int, ${l.qty}::real, ${l.note}::text)`);
    await db.execute(
      sql`UPDATE ${sql.raw(nomTable)} AS t SET qty = v.qty, note = COALESCE(v.note, t.note)
          FROM (VALUES ${sql.join(valeurs, sql`, `)}) AS v(id, qty, note) WHERE t.id = v.id`,
    );
    ecrites += paquet.length;
  }
  return ecrites;
}

async function appliquerQuantitesCatalogue(attendues: Map<string, QuantiteAttendue | null>): Promise<number> {
  const recettes = await db
    .select({ id: schema.catalogRecipes.id, sourceUrl: schema.catalogRecipes.sourceUrl })
    .from(schema.catalogRecipes);
  const urlParId = new Map(recettes.map((r) => [r.id, r.sourceUrl]));
  const rows = await db
    .select({
      id: schema.catalogIngredients.id,
      recette: schema.catalogIngredients.catalogRecipeId,
      canonical: schema.catalogIngredients.canonical,
      qty: schema.catalogIngredients.qty,
      note: schema.catalogIngredients.note,
    })
    .from(schema.catalogIngredients);
  const aEcrire = aCorriger(rows.map((r) => ({ ...r, url: urlParId.get(r.recette) ?? null })), attendues);
  const n = await ecrireQuantites("catalog_ingredients", aEcrire);
  console.log(`[ingr] quantités catalogue : ${n} ligne(s) corrigée(s) sur ${rows.length}.`);
  return n;
}

async function appliquerQuantitesBibliotheque(attendues: Map<string, QuantiteAttendue | null>): Promise<number> {
  const recettes = await db
    .select({ id: schema.recipes.id, sourceUrl: schema.recipes.sourceUrl })
    .from(schema.recipes);
  const urlParId = new Map(recettes.map((r) => [r.id, r.sourceUrl]));
  const rows = await db
    .select({
      id: schema.recipeIngredients.id,
      recette: schema.recipeIngredients.recipeId,
      canonical: schema.recipeIngredients.canonical,
      qty: schema.recipeIngredients.qty,
      note: schema.recipeIngredients.note,
    })
    .from(schema.recipeIngredients);
  const aEcrire = aCorriger(rows.map((r) => ({ ...r, url: urlParId.get(r.recette) ?? null })), attendues);
  const n = await ecrireQuantites("recipe_ingredients", aEcrire);
  console.log(`[ingr] quantités bibliothèque : ${n} ligne(s) corrigée(s) sur ${rows.length}.`);
  return n;
}

function aCorriger(
  rows: Array<{ id: number; url: string | null; canonical: string; qty: number | null; note: string | null }>,
  attendues: Map<string, QuantiteAttendue | null>,
): Array<{ id: number; qty: number | null; note: string | null }> {
  const out: Array<{ id: number; qty: number | null; note: string | null }> = [];
  for (const r of rows) {
    if (!r.url) continue; // recette apportée par Marc (vidéo, page) : aucune source seed.
    const attendu = attendues.get(`${r.url}\u0000${r.canonical}`);
    if (!attendu) continue; // absente ou ambiguë
    const memeQty = r.qty === attendu.qty || (r.qty !== null && attendu.qty !== null && Math.abs(r.qty - attendu.qty) < 1e-9);
    const noteAPoser = attendu.note !== null && !r.note;
    if (memeQty && !noteAPoser) continue;
    out.push({ id: r.id, qty: attendu.qty, note: noteAPoser ? attendu.note : null });
  }
  return out;
}

/**
 * Les listes d'épicerie ne se corrigent pas par clé : chaque ligne est une SOMME de recettes
 * mises à l'échelle. On les RECALCULE donc avec l'agrégation de l'app — « deux
 * implémentations d'une même règle, c'est une règle et demie » — puis on ne réécrit que la
 * quantité et l'unité des lignes existantes.
 *
 * ⚠️ On n'ajoute ni ne supprime AUCUNE ligne : un article ajouté à la main par Marc n'a pas
 * de recette d'origine et doit survivre intact. Et `checked` n'est jamais touché : une liste
 * en cours de courses ne se décoche pas toute seule.
 *
 * Le coût estimé suit la quantité au prorata quand les deux sont chiffrées : le laisser tel
 * quel afficherait le prix d'un kilo là où on n'achète plus que 500 g.
 */
async function recalculerListes(): Promise<number> {
  const batchs = await db.select({ id: schema.batches.id }).from(schema.batches);
  if (batchs.length === 0) return 0;
  let corrigees = 0;
  for (const b of batchs) {
    const liens = await db
      .select({ recipeId: schema.batchRecipes.recipeId, portions: schema.batchRecipes.portions })
      .from(schema.batchRecipes)
      .where(eq(schema.batchRecipes.batchId, b.id));
    if (liens.length === 0) continue;
    const ids = liens.map((l) => l.recipeId);
    const recettes = await db.select().from(schema.recipes).where(inArray(schema.recipes.id, ids));
    const ings = await db.select().from(schema.recipeIngredients).where(inArray(schema.recipeIngredients.recipeId, ids));
    const agrege = aggregateShoppingList(
      liens.map((l) => {
        const r = recettes.find((x) => x.id === l.recipeId);
        return {
          servings: r?.servings ?? 1,
          portions: l.portions,
          ingredients: ings
            .filter((i) => i.recipeId === l.recipeId)
            .map((i) => ({ name: i.name, canonical: i.canonical, qty: i.qty, unit: i.unit })),
        };
      }),
    );
    const { aAcheter } = ecarterIngredientsDeFond(agrege);
    const attendu = new Map(aAcheter.map((a) => [a.canonical, a]));
    const lignes = await db.select().from(schema.shoppingItems).where(eq(schema.shoppingItems.batchId, b.id));
    for (const ligne of lignes) {
      const a = attendu.get(ligne.canonical);
      if (!a) continue;
      if (a.qty === ligne.qty && a.unit === ligne.unit) continue;
      const cout =
        ligne.estCost !== null && ligne.qty !== null && a.qty !== null && ligne.qty > 0
          ? Math.round((ligne.estCost * a.qty) / ligne.qty * 100) / 100
          : ligne.estCost;
      await db
        .update(schema.shoppingItems)
        .set({ qty: a.qty, unit: a.unit, estCost: cout })
        .where(eq(schema.shoppingItems.id, ligne.id));
      corrigees += 1;
    }
  }
  console.log(`[ingr] listes d'épicerie : ${corrigees} ligne(s) recalculée(s) (aucune ajoutée, aucune supprimée, cases à cocher intactes).`);
  return corrigees;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[ingr] DATABASE_URL absente : correction sautée (aucune base à corriger).");
    return;
  }
  const sqlite = await ouvrirSeed();
  const map = corrections(sqlite);
  console.log(`[ingr] ${map.size} clé(s) de référence lues dans le seed.`);
  const quantites = quantitesAttendues(sqlite);
  sqlite.close();

  const cibles: [string, Table][] = [
    ["catalogue", schema.catalogIngredients],
    ["bibliothèque", schema.recipeIngredients as unknown as Table],
    ["listes d'épicerie", schema.shoppingItems as unknown as Table],
  ];
  let total = 0;
  for (const [libelle, table] of cibles) total += await appliquer(libelle, table, map);
  total += await appliquerQuantitesCatalogue(quantites);
  total += await appliquerQuantitesBibliotheque(quantites);
  total += await recalculerListes();
  console.log(
    total === 0
      ? "[ingr] Rien à corriger — la passe précédente a déjà tout traité."
      : `[ingr] Terminé : ${total} ligne(s) corrigée(s).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // Échec BRUYANT : cette passe est dans le chemin du build. Une erreur avalée donnerait un
    // déploiement vert servant des unités fausses — exactement la panne muette qu'on paie cher.
    console.error("[ingr] ÉCHEC de la correction :", err);
    process.exit(1);
  });
