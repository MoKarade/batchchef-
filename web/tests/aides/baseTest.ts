// Base de test en mémoire (PGlite), migrée avec les VRAIES migrations de `drizzle/`.
//
// Pourquoi une vraie base plutôt qu'un faux `db` : `lib/semaineDb.ts` porte du SQL qui compte
// (`coalesce` du type effectif, tirage `md5(graine || id)`, contrainte d'unicité
// `(semaine, position)`). Une imitation de Drizzle ne vérifierait rien de tout ça.
//
// ⚠️ Aucune donnée métier ici : la base naît VIDE. Chaque test y pose les lignes minimales
// dont il a besoin, nommées pour ce qu'elles sont (« recette-plat-1 »), jamais présentées
// comme des recettes réelles.
//
// `db.batch` n'existe que sur le pilote Neon HTTP ; on le reproduit par une transaction,
// ce qui est exactement sa garantie (tout ou rien).

import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../../lib/db/schema";

export type BaseTest = Awaited<ReturnType<typeof creerBaseTest>>;

export async function creerBaseTest() {
  const client = new PGlite();
  const base = drizzle(client, { schema });
  await migrate(base, {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  const batch = async (requetes: ReadonlyArray<PromiseLike<unknown>>): Promise<unknown[]> => {
    await client.query("begin");
    try {
      const sorties: unknown[] = [];
      for (const r of requetes) sorties.push(await r);
      await client.query("commit");
      return sorties;
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  };
  const db = Object.assign(base, { batch });
  /** Vide toutes les tables utiles entre deux tests (et remet les compteurs d'id à 1). */
  const vider = async (): Promise<void> => {
    await client.exec(
      "truncate week_picks, week_estimations, type_corrections, catalog_ingredients, " +
        "catalog_recipes, batch_recipes, batches, recipe_ingredients, recipes restart identity cascade",
    );
  };
  return { db, client, vider };
}
