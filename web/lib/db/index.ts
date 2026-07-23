// lib/db/index.ts — connexion Neon (driver HTTP serverless, compatible Vercel).
//
// Init PARESSEUSE : le module peut être importé au build (analyse Next) sans
// DATABASE_URL ; l'erreur honnête ne part qu'à la PREMIÈRE requête réelle. Les tests
// n'importent pas ce module : ils construisent leur propre Drizzle sur PGlite.

import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let instance: NeonHttpDatabase<typeof schema> | null = null;

function connect(): NeonHttpDatabase<typeof schema> {
  if (instance) return instance;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL manquant : configure la base Neon (cf. .env.example).");
  }
  instance = drizzle(neon(url), { schema });
  return instance;
}

/** Proxy paresseux : `db.select()…` fonctionne partout, la connexion se fait au 1ᵉʳ usage. */
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(connect(), prop, receiver);
  },
});

export { schema };
