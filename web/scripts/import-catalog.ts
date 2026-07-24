// scripts/import-catalog.ts — importe les 10 188 recettes Marmiton (base seed committée
// dans web/data/batchchef.seed.db) dans le catalogue Neon. À lancer UNE fois :
//
//   cd web
//   DATABASE_URL='postgres://...' npx tsx scripts/import-catalog.ts
//
// Idempotent : vide d'abord les tables catalogue (relancer ne duplique pas). Les unités
// brutes (cuillères/cl/pincée…) sont normalisées en g/ml/unite via lib/units. Ne touche
// JAMAIS ta bibliothèque perso (recipes) ni tes batchs.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import initSqlJs from "sql.js";
import { db, schema } from "../lib/db";
import { normalizeQty } from "../lib/units";

const require = createRequire(import.meta.url);
const SEED = path.resolve(process.cwd(), "data", "batchchef.seed.db");
const RECIPE_BATCH = 400;
const ING_BATCH = 800;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL requis (base Neon).");

  console.log("Lecture de", SEED);
  const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
  const sqlite = new SQL.Database(readFileSync(SEED));

  // Recettes (marmiton_url est unique → sert de clé de jointure vers les nouveaux ids).
  const recipeRes = sqlite.exec(
    `SELECT id, title, marmiton_url, image_url, servings, instructions FROM recipe`,
  );
  const recipeRows = rowsOf(recipeRes);
  console.log(`  ${recipeRows.length} recettes`);

  const ingRes = sqlite.exec(
    `SELECT ri.recipe_id, COALESCE(im.display_name_fr, ri.raw_text) AS name,
            COALESCE(im.canonical_name, LOWER(ri.raw_text)) AS canonical,
            ri.quantity_per_portion AS qty, ri.unit, ri.raw_text
     FROM recipe_ingredient ri
     LEFT JOIN ingredient_master im ON im.id = ri.ingredient_master_id`,
  );
  const ingRows = rowsOf(ingRes);
  console.log(`  ${ingRows.length} ingrédients`);
  sqlite.close();

  // Table d'aiguillage : ancien recipe.id → ses lignes d'ingrédients.
  const ingByRecipe = new Map<number, typeof ingRows>();
  for (const r of ingRows) {
    const key = Number(r.recipe_id);
    const list = ingByRecipe.get(key) ?? [];
    list.push(r);
    ingByRecipe.set(key, list);
  }

  console.log("Vidage des tables catalogue…");
  await db.delete(schema.catalogIngredients);
  await db.delete(schema.catalogRecipes);

  // Insertion des recettes par lots ; on récupère (id, sourceUrl) pour lier les ingrédients.
  const urlToNewId = new Map<string, number>();
  const oldIdByUrl = new Map<string, number>();
  for (const r of recipeRows) if (r.marmiton_url) oldIdByUrl.set(String(r.marmiton_url), Number(r.id));

  let done = 0;
  for (let i = 0; i < recipeRows.length; i += RECIPE_BATCH) {
    const slice = recipeRows.slice(i, i + RECIPE_BATCH);
    const inserted = await db
      .insert(schema.catalogRecipes)
      .values(
        slice.map((r) => ({
          title: String(r.title ?? "Sans titre").slice(0, 400),
          sourceUrl: r.marmiton_url ? String(r.marmiton_url) : null,
          imageUrl: r.image_url ? String(r.image_url) : null,
          servings: Number(r.servings) > 0 ? Number(r.servings) : 1,
          instructions: r.instructions ? String(r.instructions) : null,
        })),
      )
      .returning({ id: schema.catalogRecipes.id, sourceUrl: schema.catalogRecipes.sourceUrl });
    for (const row of inserted) if (row.sourceUrl) urlToNewId.set(row.sourceUrl, row.id);
    done += slice.length;
    if (done % 2000 === 0 || done === recipeRows.length) console.log(`  recettes ${done}/${recipeRows.length}`);
  }

  // Insertion des ingrédients, résolus vers le nouvel id via l'URL de leur recette.
  //
  // IMPORTANT : la base seed stocke `quantity_per_portion` (quantité pour UNE portion),
  // mais l'app attend une quantité POUR `servings` portions (cf. schema recipeIngredients).
  // On multiplie donc par le nombre de portions de la recette pour retrouver le total —
  // sinon les quantités du catalogue étaient divisées par ~servings (4× trop peu, etc.).
  const ingValues: Array<typeof schema.catalogIngredients.$inferInsert> = [];
  for (const r of recipeRows) {
    const url = r.marmiton_url ? String(r.marmiton_url) : null;
    const newId = url ? urlToNewId.get(url) : undefined;
    if (!newId) continue;
    const servings = Number(r.servings) > 0 ? Number(r.servings) : 1;
    for (const ing of ingByRecipe.get(Number(r.id)) ?? []) {
      const norm = normalizeQty(numOrNull(ing.qty), ing.unit as string | null, String(ing.raw_text ?? ""));
      const total = norm.qty === null ? null : Math.round(norm.qty * servings * 100) / 100;
      ingValues.push({
        catalogRecipeId: newId,
        name: String(ing.name ?? "ingrédient").slice(0, 200),
        canonical: String(ing.canonical ?? "").toLowerCase().trim().slice(0, 120) || "ingredient",
        qty: total,
        unit: norm.unit,
        note: norm.qty === null && ing.raw_text ? String(ing.raw_text).slice(0, 200) : null,
      });
    }
  }
  console.log(`Insertion de ${ingValues.length} ingrédients…`);
  for (let i = 0; i < ingValues.length; i += ING_BATCH) {
    await db.insert(schema.catalogIngredients).values(ingValues.slice(i, i + ING_BATCH));
    if ((i / ING_BATCH) % 20 === 0) console.log(`  ingrédients ${Math.min(i + ING_BATCH, ingValues.length)}/${ingValues.length}`);
  }

  console.log(`✔ Catalogue importé : ${urlToNewId.size} recettes, ${ingValues.length} ingrédients.`);
}

type Row = Record<string, unknown>;
function rowsOf(res: initSqlJs.QueryExecResult[]): Row[] {
  if (res.length === 0) return [];
  const { columns, values } = res[0]!;
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])) as Row);
}
function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
