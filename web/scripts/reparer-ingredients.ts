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
import { sql } from "drizzle-orm";
import initSqlJs from "sql.js";
import { db, schema } from "../lib/db";
import { reparerCanonique, reparerNom } from "../lib/ingredientsNoms";
import { nomRestaure, uniteCorrigee } from "../lib/ingredientsSource";

const require = createRequire(import.meta.url);
const SEED = path.resolve(process.cwd(), "data", "batchchef.seed.db");

interface Correction {
  /** `null` = les sources ne s'accordent pas sur le nom : on n'y touche pas. */
  nom: string | null;
  /** `null` = pas de correction d'unité (rien à corriger, ou sources en désaccord). */
  unite: "unite" | null;
}

/** Construit, depuis le seed, ce que chaque clé de PRODUCTION devrait porter. */
async function corrections(): Promise<Map<string, Correction>> {
  const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
  const sqlite = new SQL.Database(readFileSync(SEED));

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
    const nom = nomRestaure(reparerNom(n), src);
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
  sqlite.close();

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
    if (!corr) continue;
    const nom = corr.nom ?? c.name;
    // ⚠️ On ne corrige l'unité QUE si elle est aujourd'hui une mesure de masse/volume.
    // `unite` et `null` sont laissés tels quels : on répare une erreur, on n'impose rien.
    const unite = corr.unite && (c.unit === "g" || c.unit === "ml") ? corr.unite : c.unit;
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

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[ingr] DATABASE_URL absente : correction sautée (aucune base à corriger).");
    return;
  }
  const map = await corrections();
  console.log(`[ingr] ${map.size} clé(s) de référence lues dans le seed.`);

  const cibles: [string, Table][] = [
    ["catalogue", schema.catalogIngredients],
    ["bibliothèque", schema.recipeIngredients as unknown as Table],
    ["listes d'épicerie", schema.shoppingItems as unknown as Table],
  ];
  let total = 0;
  for (const [libelle, table] of cibles) total += await appliquer(libelle, table, map);
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
