// Base Postgres EN MÉMOIRE (PGlite) pour les tests des fonctions de travail.
//
// Pourquoi une vraie base plutôt qu'un faux constructeur de requêtes : les fonctions
// `*Interne` enchaînent insert/returning/update, et un faux qui répondrait « ce qu'on attend »
// ne prouverait rien. Ici les VRAIES migrations Drizzle du dépôt sont appliquées : contraintes,
// clés étrangères et valeurs par défaut sont celles de la production. Aucune donnée n'est
// présente au départ ; chaque test pose les siennes, neutres et nommées comme telles.

import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

export type BaseTest = PgliteDatabase<typeof schema>;

const DOSSIER_MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Crée une base vide au schéma de production (migrations appliquées). */
export async function creerBaseTest(): Promise<BaseTest> {
  const client = new PGlite();
  const base = drizzle(client, { schema });
  await migrate(base, { migrationsFolder: DOSSIER_MIGRATIONS });
  return base;
}

/** Vide toutes les tables métier entre deux tests (identités remises à 1). */
export async function viderBase(base: BaseTest): Promise<void> {
  const lignes = await base.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const tables = lignes.rows.map((l) => `"${l.tablename}"`);
  if (tables.length === 0) return;
  await base.execute(sql.raw(`truncate ${tables.join(", ")} restart identity cascade`));
}
