// Le garde-manger : ce que Marc a TOUJOURS chez lui et ne rachète pas.
//
// Sans lui, tout ce que les recettes demandent atterrit sur la liste d'épicerie — sel,
// poivre, huile, farine. Deux effets : du bruit en magasin, et un budget gonflé par ce qu'on
// ne rachète jamais.
//
// ⚠️ RÈGLE NON NÉGOCIABLE : on ne RETIRE jamais silencieusement une ligne d'une liste de
// courses. Un article du garde-manger est DÉPLACÉ dans une section « à vérifier au placard »,
// toujours visible et toujours cochable. Le jour où le pot d'huile est vide, la ligne doit
// être là — la supprimer ferait rentrer Marc sans son huile, et l'app ne le saurait jamais.
//
// Décision de Marc (17/08/2026) : la liste part VIDE. Aucune liste standard supposée — il
// déclare ses articles au fil des courses, sur ceux qu'il voit vraiment passer.

/** Un article de liste, réduit à ce qui décide de son classement. */
export interface ArticleClassable {
  canonical: string;
}

export interface ListeSeparee<T> {
  /** Ce qu'il faut vraiment acheter. */
  aAcheter: T[];
  /** Ce que Marc a déclaré avoir toujours — à vérifier, pas à racheter d'office. */
  auPlacard: T[];
}

/**
 * Normalise une clé de regroupement avant comparaison.
 *
 * `shopping_items.canonical` est déjà produit normalisé par le parse, mais le garde-manger
 * se remplit à partir de ce que Marc voit à l'écran : mieux vaut re-normaliser des deux
 * côtés que de dépendre d'une égalité d'octets. Accents retirés, casse et espaces aplatis.
 */
export function cleGardeManger(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sépare une liste en « à acheter » et « au placard ».
 *
 * ⚠️ La correspondance est EXACTE sur la clé, jamais par sous-chaîne. Une heuristique floue
 * peut grouper ce qu'on REGARDE, jamais décider ce qui DISPARAÎT d'une liste de courses :
 * « huile » attraperait « huile de truffe », et « lait » attraperait « lait de coco ». Ici
 * une erreur ne se voit pas — elle se découvre au retour du magasin.
 */
export function separerGardeManger<T extends ArticleClassable>(
  articles: readonly T[],
  gardeManger: readonly string[],
): ListeSeparee<T> {
  const placard = new Set(gardeManger.map(cleGardeManger));
  const aAcheter: T[] = [];
  const auPlacard: T[] = [];
  for (const article of articles) {
    (placard.has(cleGardeManger(article.canonical)) ? auPlacard : aAcheter).push(article);
  }
  return { aAcheter, auPlacard };
}

/**
 * Valide un article qu'on ajoute au garde-manger.
 *
 * Une clé vide viderait la moitié de la liste au premier article sans nom : elle est refusée.
 */
export function validerAjoutGardeManger(
  nom: string,
  canonical: string,
): { ok: true; nom: string; cle: string } | { ok: false; erreur: string } {
  const cle = cleGardeManger(canonical);
  if (!cle) return { ok: false, erreur: "Cet article n'a pas de clé exploitable." };
  const propre = nom.trim() || canonical.trim();
  if (!propre) return { ok: false, erreur: "Cet article n'a pas de nom." };
  return { ok: true, nom: propre, cle };
}
