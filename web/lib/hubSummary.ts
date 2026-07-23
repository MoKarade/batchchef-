// lib/hubSummary.ts — construit le résumé BatchChef pour le hub perso (hubperso.com),
// conforme au contrat @mokarade/hub-contract v1. Données RÉELLES agrégées depuis Neon ;
// base vide → status "building" (jamais de chiffres inventés).
//
// Deux couches : `composeBatchchefSummary` est PURE (agrégats → HubSummary validé, testable
// sans base), `buildBatchchefSummary` lit Neon puis délègue à la première.

import { and, count, eq, inArray, sql } from "drizzle-orm";
import { validateSummary, type HubSummary } from "@mokarade/hub-contract";
import { db, schema } from "@/lib/db";

const APP_COLOR = "#c2410c"; // orange cuisine
const ACTIVE = ["planifie", "courses", "cuisine"] as const;

export function publicUrl(): string {
  const raw = (process.env.BATCHCHEF_PUBLIC_URL || "https://batchchef-glu8-chi.vercel.app").trim();
  return raw.replace(/\/+$/, "");
}

/** Agrégats bruts nécessaires au summary (tous côté données, jamais inventés). */
export interface BatchchefCounts {
  recipes: number;
  batches: number;
  activeBatches: number;
  toBuy: number;
  budgetRemaining: number;
}

/** Compose un HubSummary VALIDÉ à partir des agrégats (jette si le payload dévie du contrat). */
export function composeBatchchefSummary(counts: BatchchefCounts, base = publicUrl()): HubSummary {
  const budgetRemaining = Math.round(counts.budgetRemaining * 100) / 100;

  // Base VRAIMENT vide (aucune recette, aucun batch) → état honnête "building", pas "ok à 0".
  const status: HubSummary["status"] =
    counts.recipes === 0 && counts.batches === 0 ? "building" : "ok";

  const metrics: HubSummary["metrics"] = [
    { label: "Recettes", value: counts.recipes, format: "number" },
    { label: "Batchs actifs", value: counts.activeBatches, format: "number" },
    {
      label: "Articles à acheter",
      value: counts.toBuy,
      format: "number",
      severity: counts.toBuy > 0 ? "warn" : "ok",
    },
    { label: "Budget restant (est.)", value: budgetRemaining, format: "currency" },
  ];

  const alerts: HubSummary["alerts"] = [];
  if (counts.toBuy > 0) {
    alerts.push({
      label: `${counts.toBuy} article(s) d'épicerie à acheter`,
      severity: "info",
      href: `${base}/batchs`,
    });
  }

  const summary = {
    contractVersion: 1 as const,
    app: { id: "batchchef", name: "BatchChef", url: base, color: APP_COLOR },
    generatedAt: new Date().toISOString(),
    status,
    metrics,
    alerts,
    actions: [{ label: "Ouvrir BatchChef", kind: "link" as const, href: base }],
  };

  // Conformité prouvée à l'émission : un payload hors contrat jette ici, pas chez le hub.
  return validateSummary(summary);
}

/** Lit l'état réel depuis Neon et compose le HubSummary. */
export async function buildBatchchefSummary(): Promise<HubSummary> {
  const [recipes] = await db.select({ n: count() }).from(schema.recipes);
  const [batches] = await db.select({ n: count() }).from(schema.batches);
  const [activeBatches] = await db
    .select({ n: count() })
    .from(schema.batches)
    .where(inArray(schema.batches.status, [...ACTIVE]));
  const [toBuy] = await db
    .select({ n: count() })
    .from(schema.shoppingItems)
    .innerJoin(schema.batches, eq(schema.batches.id, schema.shoppingItems.batchId))
    .where(and(eq(schema.shoppingItems.checked, false), inArray(schema.batches.status, [...ACTIVE])));
  const [budget] = await db
    .select({ sum: sql<number>`coalesce(sum(${schema.shoppingItems.estCost}), 0)` })
    .from(schema.shoppingItems)
    .innerJoin(schema.batches, eq(schema.batches.id, schema.shoppingItems.batchId))
    .where(
      and(
        eq(schema.shoppingItems.checked, false),
        inArray(schema.batches.status, [...ACTIVE]),
        // uniquement les lignes RÉELLEMENT chiffrées (jamais un total qui ment sur sa complétude)
        sql`${schema.shoppingItems.estCost} is not null`,
      ),
    );

  return composeBatchchefSummary({
    recipes: recipes?.n ?? 0,
    batches: batches?.n ?? 0,
    activeBatches: activeBatches?.n ?? 0,
    toBuy: toBuy?.n ?? 0,
    budgetRemaining: Number(budget?.sum ?? 0),
  });
}
