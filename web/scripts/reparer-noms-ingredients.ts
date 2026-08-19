// Répare les noms d'ingrédients hérités du catalogue V3 (ING-03), PARTOUT où ils ont atterri.
//
// Lancé automatiquement par `vercel-build`, avant `next build` : exigence de Marc, il ne doit
// jamais avoir de commande à taper. La passe est IDEMPOTENTE et sort en une requête quand il
// n'y a plus rien à réparer, donc la rejouer à chaque déploiement ne coûte rien.
//
// ⚠️ TROIS tables, pas une. Le catalogue est la SOURCE du défaut, mais les noms se sont
// propagés : `ajouterDuCatalogue` copie une recette du catalogue vers la bibliothèque de
// Marc, et la création d'un batch recopie encore vers la liste d'épicerie. Ne réparer que le
// catalogue aurait laissé abîmé précisément ce que Marc regarde — c'est la leçon JobAI
// « le chemin de rattrapage se livre DANS le même lot que la colonne ».
//
// ⚠️ Ce que cette passe ne fait PAS : fusionner deux lignes d'une liste d'épicerie DÉJÀ
// créée. Réparer les noms les rend lisibles et les fera fusionner aux PROCHAINS batchs ;
// fusionner rétroactivement changerait des quantités sur une liste contre laquelle Marc a
// peut-être déjà fait ses courses. On répare ce qu'on affiche, on ne réécrit pas son passé.

import { or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { estNomAbime, reparerCanonique, reparerNom } from "../lib/ingredientsNoms";

/** Les motifs SQL qui SÉLECTIONNENT les candidats. Le tri fin reste à la fonction pure :
 *  ceci ne sert qu'à ne pas rapatrier 100 000 lignes pour en changer 2 000. */
const CANDIDATS = ["À Soupe %", "À Café %", "À Cafe %", "À Thé %", "Ousses%", "S De %", "S D'%"];

async function reparerTable(
  table: typeof schema.catalogIngredients,
): Promise<{ valeurs: number; lignes: number }> {
  const filtre = or(...CANDIDATS.map((p) => sql`${table.name} ILIKE ${p}`)) as SQL;

  // On travaille sur les COUPLES DISTINCTS (nom, clé), pas ligne à ligne : le catalogue a
  // 87 000 lignes d'ingrédients pour 15 000 noms.
  const couples = await db
    .selectDistinct({ name: table.name, canonical: table.canonical })
    .from(table)
    .where(filtre);

  let valeurs = 0;
  let lignes = 0;
  for (const c of couples) {
    if (!estNomAbime(c.name)) continue; // le filtre SQL ratisse large, la fonction pure tranche
    const nom = reparerNom(c.name);
    const canonical = reparerCanonique(c.canonical);
    if (nom === c.name && canonical === c.canonical) continue;
    const res = await db
      .update(table)
      .set({ name: nom, canonical })
      .where(sql`${table.name} = ${c.name} AND ${table.canonical} = ${c.canonical}`)
      .returning({ id: table.id });
    valeurs += 1;
    lignes += res.length;
  }
  return { valeurs, lignes };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    // Pas une panne : un build sans base (préversion locale) n'a rien à réparer. On le DIT
    // plutôt que de sortir en silence — « rien fait » et « pas pu » ne se confondent pas.
    console.log("[noms] DATABASE_URL absente : réparation sautée (aucune base à réparer).");
    return;
  }

  const cibles: [string, typeof schema.catalogIngredients][] = [
    ["catalogue", schema.catalogIngredients],
    ["bibliothèque", schema.recipeIngredients as unknown as typeof schema.catalogIngredients],
    ["listes d'épicerie", schema.shoppingItems as unknown as typeof schema.catalogIngredients],
  ];

  let total = 0;
  for (const [libelle, table] of cibles) {
    const { valeurs, lignes } = await reparerTable(table);
    total += lignes;
    // On trace CHAQUE table, même à zéro : « 0 » et l'absence de ligne disent des choses
    // opposées, et c'est ce qui permet de distinguer « déjà réparé » de « jamais tourné ».
    console.log(`[noms] ${libelle} : ${valeurs} nom(s) distinct(s) réparé(s), ${lignes} ligne(s) mise(s) à jour.`);
  }
  console.log(
    total === 0
      ? "[noms] Rien à réparer — la passe précédente a déjà tout traité."
      : `[noms] Terminé : ${total} ligne(s) réparée(s).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // ⚠️ On ÉCHOUE bruyamment : cette passe est dans le chemin du build. Une erreur avalée
    // ici donnerait un déploiement vert servant des noms abîmés, exactement le genre de
    // panne muette que ce dépôt paie cher.
    console.error("[noms] ÉCHEC de la réparation :", err);
    process.exit(1);
  });
