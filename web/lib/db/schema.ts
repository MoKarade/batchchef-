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

/**
 * Codes et jetons de rafraîchissement OAuth DÉJÀ CONSOMMÉS (usage unique, OAuth 2.1).
 *
 * ⚠️ C'est la SEULE partie de l'OAuth qui ne peut pas être sans état — tout le reste est
 * signé et se vérifie sans rien stocker. FinanceAI garde cette liste en mémoire, ce qui
 * tient sur une instance Cloud Run chaude ; ici ça ne protégerait rien : Vercel démarre des
 * instances à froid et en parallèle, donc un code rejoué tomberait presque toujours sur une
 * mémoire vierge. La base est la seule mémoire partagée par toutes les instances.
 *
 * `expiresAt` porte l'expiration du jeton : au-delà, la ligne ne sert plus à rien (la
 * signature est déjà refusée sur la date) et se purge.
 */
export const mcpOauthConsumed = pgTable("mcp_oauth_consumed", {
  jti: text("jti").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/**
 * Tentatives ratées sur la page de consentement OAuth, par fenêtre de temps.
 *
 * ⚠️ `/api/mcp/oauth/authorize` est la SEULE porte devinable du serveur : c'est le seul
 * endroit qui compare une clé saisie à la main (l'échange de code, lui, exige une signature
 * HMAC). Un plafond y est donc nécessaire — et il doit vivre en BASE, pas en mémoire :
 * en serverless, un compteur de process est remis à zéro par la prochaine instance, ce qui
 * en fait un garde décoratif.
 *
 * Le minimum de longueur imposé à `MCP_TOKEN` ne suffit pas à lui seul : il borne la
 * longueur, pas l'ENTROPIE. Une clé de seize caractères choisie à la main se devine en
 * quelques millions d'essais ; c'est ce plafond qui rend ces millions d'essais impossibles.
 */
export const mcpOauthAttempts = pgTable("mcp_oauth_attempts", {
  /** Fenêtre courante, ex. "2026-08-19T16" — une ligne par heure, pas par tentative. */
  fenetre: text("fenetre").primaryKey(),
  echecs: integer("echecs").notNull().default(0),
});

export type Recipe = typeof recipes.$inferSelect;
export type CatalogRecipe = typeof catalogRecipes.$inferSelect;
export type CatalogIngredient = typeof catalogIngredients.$inferSelect;
export type RecipeIngredient = typeof recipeIngredients.$inferSelect;
export type Batch = typeof batches.$inferSelect;
export type BatchRecipe = typeof batchRecipes.$inferSelect;
export type ShoppingItem = typeof shoppingItems.$inferSelect;
