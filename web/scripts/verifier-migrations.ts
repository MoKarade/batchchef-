// Vérifie, APRÈS `db:migrate`, que la base contient la dernière migration du dépôt. Lancé par `vercel-build`
// (production seulement). Échec fermé : sortie 1 = le build s'arrête, la version précédente reste en ligne.
//
// Pourquoi ce n'est pas `drizzle-kit migrate` qu'on croit sur parole : il peut sortir en code 0 sans rien
// appliquer (voir lib/verifierMigrations.ts). Ici on LIT la table de suivi par le chemin HTTP de l'app
// (`neon-http`), qui ne demande aucun WebSocket, et on imprime la preuve dans le journal de build.
//
// Lecture seule : un seul SELECT sur drizzle.__drizzle_migrations. Aucune écriture.

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { verifierMigrations, type LigneSuivi, type MigrationAttendue } from "../lib/verifierMigrations";

/** `neon()` recopie la chaîne de connexion dans ses erreurs : on ne l'imprime jamais telle quelle. */
function masquer(message: string, url: string | undefined): string {
  let sortie = message;
  if (url) sortie = sortie.split(url).join("[DATABASE_URL masquée]");
  return sortie.replace(/postgres(ql)?:\/\/[^\s'"]+/g, "[chaîne de connexion masquée]");
}

async function lireSuivi(url: string): Promise<LigneSuivi[] | null> {
  const sql = neon(url);
  const existe = (await sql`select to_regclass('drizzle.__drizzle_migrations') as t`) as { t: string | null }[];
  if (existe[0]?.t == null) return null;
  return (await sql`select created_at from drizzle.__drizzle_migrations`) as LigneSuivi[];
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url?.trim()) {
    console.error("[migrations] DATABASE_URL absente : impossible de vérifier la base.");
    process.exit(1);
  }
  const journal = JSON.parse(readFileSync("./drizzle/meta/_journal.json", "utf8")) as { entries: MigrationAttendue[] };
  const attendues = journal.entries.map((e) => ({ tag: e.tag, when: e.when }));

  const verdict = verifierMigrations(attendues, await lireSuivi(url));
  if (!verdict.ok) {
    console.error(`[migrations] ÉCHEC : ${verdict.message}`);
    process.exit(1);
  }
  console.log(`[migrations] ${verdict.message}`);
  for (const a of verdict.avertissements) console.warn(`[migrations] avertissement : ${a}`);
}

main().catch((err: unknown) => {
  const brut = err instanceof Error ? `${err.message}${err.cause instanceof Error ? ` (${err.cause.message})` : ""}` : String(err);
  console.error(`[migrations] ÉCHEC de la vérification : ${masquer(brut, process.env.DATABASE_URL)}`);
  process.exit(1);
});
