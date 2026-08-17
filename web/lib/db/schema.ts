// lib/db/schema.ts — schéma Drizzle (Postgres/Neon).
//
// Recettes (bibliothèque perso), batchs, liste d'épicerie. Les prix sont TOUJOURS des
// estimations (LLM + filet déterministe, couverture 100 %) ; il n'y a pas de prix « réels »
// relevés — pas de suivi de prix magasin prévu (trop de friction pour la valeur).

import {
  boolean,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Bibliothèque perso : recettes importées par URL (parse LLM) ou saisies à la main. */
export const recipes = pgTable("recipes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  /** URL d'origine si importée (n'importe quel site) ; null si saisie manuelle. */
  sourceUrl: text("source_url"),
  /**
   * D'où vient la recette : "video" / "page" (apportées par Marc) ou "catalogue".
   * NULL pour les recettes créées avant cette colonne — on ne devine pas leur provenance,
   * l'affichage dit alors « origine non enregistrée ». Cf. `lib/origine.ts`.
   */
  origine: text("origine"),
  imageUrl: text("image_url"),
  /** Nombre de portions de RÉFÉRENCE des quantités d'ingrédients. */
  servings: integer("servings").notNull().default(4),
  instructions: text("instructions"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recipeIngredients = pgTable("recipe_ingredients", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id")
    .notNull()
    .references(() => recipes.id, { onDelete: "cascade" }),
  /** Nom tel qu'affiché (fr), ex. « poitrines de poulet ». */
  name: text("name").notNull(),
  /** Clé de regroupement normalisée (minuscules, singulier approx.) pour l'agrégation. */
  canonical: text("canonical").notNull(),
  /** Quantité pour `recipes.servings` portions ; null = « au goût ». */
  qty: real("qty"),
  /** g | ml | unite — normalisée au parse (kg→g, l→ml, c. à soupe→ml…). */
  unit: text("unit", { enum: ["g", "ml", "unite"] }),
  note: text("note"),
});

export const batches = pgTable("batches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status", { enum: ["planifie", "courses", "cuisine", "termine"] })
    .notNull()
    .default("planifie"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Id de la liste Google Tasks déjà créée pour ce batch (réexport = mise à jour, pas doublon). */
  googleTaskListId: text("google_task_list_id"),
});

export const batchRecipes = pgTable("batch_recipes", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id")
    .notNull()
    .references(() => batches.id, { onDelete: "cascade" }),
  recipeId: integer("recipe_id")
    .notNull()
    .references(() => recipes.id, { onDelete: "restrict" }),
  /** Portions voulues pour CE batch (les quantités sont mises à l'échelle). */
  portions: integer("portions").notNull(),
});

/** Liste d'épicerie agrégée d'un batch (générée, puis cochable en magasin). */
export const shoppingItems = pgTable("shopping_items", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id")
    .notNull()
    .references(() => batches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  canonical: text("canonical").notNull(),
  qty: real("qty"),
  unit: text("unit", { enum: ["g", "ml", "unite"] }),
  /** Coût estimé CAD pour la quantité (toujours renseigné : couverture 100 %). */
  estCost: real("est_cost"),
  checked: boolean("checked").notNull().default(false),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
});

/**
 * Ce qui SORT d'un batch : les portions rangées, et ce qu'il en reste.
 *
 * Le cycle s'arrêtait à « terminé » — l'app servait le dimanche et plus rien du lundi au
 * samedi. Une ligne par (batch, recette, zone), avec un compteur : consommer, c'est
 * décrémenter ; à zéro, la ligne est supprimée.
 *
 * ⚠️ Les deux clés étrangères sont en `set null`, à l'inverse du reste du schéma, et c'est
 * VOULU : ce qu'il y a dans le congélateur existe pour de vrai. Supprimer un batch (un
 * artefact de PLANIFICATION) ou faire le ménage dans la bibliothèque ne doit pas effacer de
 * la nourriture. D'où aussi `titre`, une COPIE prise au rangement : l'écran de stock se lit
 * sans jointure et survit à la disparition de la recette.
 */
export const portions = pgTable("portions", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").references(() => batches.id, { onDelete: "set null" }),
  recipeId: integer("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
  /** Titre de la recette au moment du rangement (copie assumée, pas une jointure). */
  titre: text("titre").notNull(),
  zone: text("zone", { enum: ["frigo", "congelo"] }).notNull(),
  /** Portions RESTANTES. La ligne est supprimée quand ça tombe à 0. */
  restantes: integer("restantes").notNull(),
  /** Quand elles ont été RANGÉES (le geste de Marc), pas quand le batch a été créé. */
  rangeLe: timestamp("range_le", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Garde-manger : ce que Marc a TOUJOURS et ne rachète pas.
 *
 * Décision de Marc (17/08/2026) : la table part VIDE, il la remplit au fil des courses.
 * Aucune liste standard supposée — l'app ne devine pas ce qu'il y a dans son placard.
 *
 * ⚠️ Ces articles ne sont jamais RETIRÉS d'une liste de courses, seulement déplacés dans une
 * section « à vérifier au placard » : le jour où le pot est vide, la ligne doit être là.
 */
export const pantry = pgTable("pantry", {
  id: serial("id").primaryKey(),
  /** Clé de regroupement normalisée, la même famille que `shopping_items.canonical`. */
  canonical: text("canonical").notNull().unique(),
  /** Nom tel que Marc l'a vu quand il l'a déclaré (c'est lui qu'on lui réaffiche). */
  nom: text("nom").notNull(),
  ajouteLe: timestamp("ajoute_le", { withTimezone: true }).notNull().defaultNow(),
});

// ── Catalogue de découverte (les 10 188 recettes Marmiton de la V3) ──────────────
// Corpus SÉPARÉ de la bibliothèque perso : lecture seule, cherchable, source d'idées.
// « Ajouter à ma bibliothèque » copie une entrée du catalogue vers recipes/recipeIngredients.
// Peuplé une fois par scripts/import-catalog.ts (unités normalisées à l'import).

export const catalogRecipes = pgTable("catalog_recipes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  sourceUrl: text("source_url"),
  imageUrl: text("image_url"),
  servings: integer("servings").notNull().default(1),
  instructions: text("instructions"),
});

export const catalogIngredients = pgTable("catalog_ingredients", {
  id: serial("id").primaryKey(),
  catalogRecipeId: integer("catalog_recipe_id")
    .notNull()
    .references(() => catalogRecipes.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  canonical: text("canonical").notNull(),
  qty: real("qty"),
  unit: text("unit", { enum: ["g", "ml", "unite"] }),
  note: text("note"),
});

// ── Usage LLM (coût API) ─────────────────────────────────────────────────────────
// Une ligne par appel LLM : tokens consommés + coût USD estimé. Sert au bloc `usage`
// du summary hub (« Coûts & quotas »). Enregistrement best-effort : un échec n'interrompt
// jamais le flux utilisateur (parse/estimation).
export const llmUsage = pgTable("llm_usage", {
  id: serial("id").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  /** "parse" | "verify" | "estimate" — d'où vient l'appel. */
  action: text("action").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  /** Coût estimé en USD (tokens × tarif du modèle). */
  costUsd: real("cost_usd").notNull().default(0),
});

export type Recipe = typeof recipes.$inferSelect;
export type CatalogRecipe = typeof catalogRecipes.$inferSelect;
export type CatalogIngredient = typeof catalogIngredients.$inferSelect;
export type RecipeIngredient = typeof recipeIngredients.$inferSelect;
export type Batch = typeof batches.$inferSelect;
export type BatchRecipe = typeof batchRecipes.$inferSelect;
export type ShoppingItem = typeof shoppingItems.$inferSelect;
export type PortionStock = typeof portions.$inferSelect;
export type PantryItem = typeof pantry.$inferSelect;
