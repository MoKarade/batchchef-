// lib/db/schema.ts — schéma Drizzle (Postgres/Neon).
//
// Recettes (bibliothèque perso), batchs, liste d'épicerie. Les prix sont TOUJOURS des
// estimations (LLM + filet déterministe, couverture 100 %) ; il n'y a pas de prix « réels »
// relevés — pas de suivi de prix magasin prévu (trop de friction pour la valeur).

import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { expressionSql } from "../rechercheNormalisee";

/**
 * Colonne de recherche DÉRIVÉE, calculée par Postgres à chaque écriture (CAT-B).
 *
 * ⚠️ GÉNÉRÉE, jamais remplie par du code : un chemin d'insertion ne peut pas l'oublier.
 * C'est le défaut qui a fait perdre une colonne quatre fois de suite chez JobAI — quatre
 * `INSERT` recopiés, un champ neuf absent des quatre, aucune erreur nulle part.
 *
 * L'expression vient de `expressionSql`, seule source de la règle : la version TypeScript
 * qui normalise la requête de l'utilisateur est fabriquée depuis les MÊMES constantes.
 */
const colonneRecherche = (nomSql: string, source: string) =>
  text(nomSql).generatedAlwaysAs(sql.raw(expressionSql(source)));

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
  /** Minutes. Renseignées quand la recette vient du catalogue ; `null` sinon. */
  prepMinutes: integer("prep_minutes"),
  cuissonMinutes: integer("cuisson_minutes"),
  /** Difficulté ESTIMÉE en étoiles, comme au catalogue (SEM-05). Recalculée au déploiement. */
  difficulteEstimee: integer("difficulte_estimee"),
  titreRecherche: colonneRecherche("titre_recherche", "title"),
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
  nomRecherche: colonneRecherche("nom_recherche", "name"),
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
  /** Minutes, telles que le seed les porte. `null` = la source ne dit rien (cf. lib/tempsRecette.ts). */
  prepMinutes: integer("prep_minutes"),
  cuissonMinutes: integer("cuisson_minutes"),
  /**
   * Type de plat ESTIMÉ (SEM-01) — une des sept familles de `lib/typePlat.ts`, ou `null`
   * quand rien ne tranche. DÉRIVÉ du titre et des ingrédients, recalculé à chaque
   * déploiement comme les noms et les quantités : ne jamais l'écrire à la main, ce serait
   * écrasé au build suivant. La correction manuelle vit dans `typeCorrections`.
   */
  typeEstime: text("type_estime"),
  /**
   * Difficulté ESTIMÉE en étoiles, 1 à 5 (SEM-05), ou `null` quand moins de deux des trois
   * signaux sont lisibles. DÉRIVÉE du nombre d'ingrédients, du nombre d'étapes et de la
   * durée — recalculée à chaque déploiement comme `typeEstime` : ne jamais l'écrire à la
   * main, ce serait écrasé au build suivant. Cf. `lib/difficulte.ts`.
   */
  difficulteEstimee: integer("difficulte_estimee"),
  titreRecherche: colonneRecherche("titre_recherche", "title"),
});

/**
 * Corrections de Marc sur le type d'une recette du catalogue (SEM-01). Elles l'emportent sur
 * l'estimation, et RIEN ne les écrase.
 *
 * ⚠️ La clé est `source_url`, PAS l'id du catalogue. `npm run catalog:import` reconstruit le
 * catalogue entier depuis le seed committé : les ids changent, l'URL non. Une correction
 * indexée par id disparaîtrait à la première réimportation, sans la moindre erreur — c'est
 * la même leçon que `menageCatalogue`, où l'exemplaire conservé se choisit sur l'URL.
 *
 * ⚠️ `type` peut valoir `null` et ce n'est PAS « pas de correction » : c'est Marc qui dit
 * « aucune de ces familles ». Les deux se distinguent par la PRÉSENCE de la ligne
 * (cf. `typeEffectif`), sinon sa décision serait remplacée par l'estimation au build suivant.
 */
export const typeCorrections = pgTable("type_corrections", {
  id: serial("id").primaryKey(),
  sourceUrl: text("source_url").notNull().unique(),
  type: text("type"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  nomRecherche: colonneRecherche("nom_recherche", "name"),
});

// ── Proposition de la semaine (SEM-02) ───────────────────────────────────────────
// Quatre recettes du CATALOGUE proposées à Marc pour la semaine en cours. Une seule semaine
// vivante : la nouvelle remplace l'ancienne (décision de Marc, 14/09/2026).
//
// ⚠️ L'unicité de `(semaine, position)` n'est pas décorative. Deux onglets ouverts le même
// lundi matin fabriqueraient la semaine en même temps : sans cette contrainte, la seconde
// écriture doublerait la proposition. Une garantie d'unicité vit dans l'ÉCRITURE, jamais
// dans une lecture qui la précède.

export const weekPicks = pgTable(
  "week_picks",
  {
    id: serial("id").primaryKey(),
    /** Semaine ISO dans le fuseau de Marc, « 2026-W38 » (cf. lib/semaine.ts). */
    semaine: text("semaine").notNull(),
    catalogRecipeId: integer("catalog_recipe_id")
      .notNull()
      .references(() => catalogRecipes.id, { onDelete: "cascade" }),
    /** 0 à 3 — l'ordre d'affichage, et ce que « remplace la deuxième » désigne. */
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("week_picks_semaine_position").on(t.semaine, t.position)],
);

/**
 * Le prix estimé d'une SEMAINE (SEM-05). Une ligne par semaine, recalculée quand la
 * composition change.
 *
 * ⚠️ `signature` n'est pas décorative : sans elle, remplacer une recette laisserait le prix
 * de l'ANCIENNE composition à l'écran — un chiffre qui décrit une semaine qui n'existe plus,
 * et qui a l'exacte apparence d'une mesure. C'est elle qui déclenche le recalcul.
 *
 * ⚠️ `methode` distingue « estimé comme le batch » (`llm`) de « filet déterministe seul »
 * (`filet`, quand l'appel a échoué). L'écran le DIT : les confondre présenterait un tarif
 * forfaitaire comme une estimation par ingrédient.
 */
export const weekEstimations = pgTable("week_estimations", {
  id: serial("id").primaryKey(),
  /** Semaine ISO dans le fuseau de Marc, « 2026-W38 ». */
  semaine: text("semaine").notNull().unique(),
  /** Les ids du catalogue de la semaine, triés et joints — l'empreinte de la composition. */
  signature: text("signature").notNull(),
  /** En CENTS : un entier, pour qu'aucun arrondi ne s'accumule au stockage. */
  prixCents: integer("prix_cents").notNull(),
  /** "llm" | "filet" — comment le chiffre a été obtenu. */
  methode: text("methode").notNull(),
  calculeLe: timestamp("calcule_le", { withTimezone: true }).notNull().defaultNow(),
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
