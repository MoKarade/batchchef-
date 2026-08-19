// Les ingrédients qu'on ne met JAMAIS sur une liste d'épicerie.
//
// Demande de Marc (17/08/2026) : « je veux plus que ça me demande d'acheter du sel ou
// poivre ». Le besoin est le même que celui du garde-manger livré puis retiré le même jour —
// mais la solution est l'INVERSE : ici rien à déclarer, rien à tenir à jour, aucun écran de
// gestion. La liste est FERMÉE, elle vit dans le code, et elle ne contient que ce que
// personne n'achète à la recette.
//
// ⚠️ Trois raisons de ne pas l'élargir sans y penser à deux fois :
//   1. L'huile, la farine, le sucre, le beurre s'ACHÈTENT — les retirer ferait rentrer Marc
//      sans ce qu'il lui faut. La frontière est « ça se rachète » vs « c'est là, point ».
//   2. Ce qui sort de la liste sort aussi du BUDGET. Un ajout silencieux fait baisser un
//      chiffre sans que personne ne comprenne pourquoi.
//   3. L'app le DIT à l'écran (cf. `resumerIngredientsDeFond`). Retirer sans le dire, c'est
//      la faute que le garde-manger évitait justement.

/** Normalise pour comparer : accents retirés, casse et espaces aplatis. */
function cle(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Mots qui, PRÉSENTS COMME MOT ENTIER, désignent un ingrédient de fond.
 *
 * ⚠️ La comparaison est faite MOT À MOT, jamais par sous-chaîne. « poivron » contient
 * « poivr », « persil » ressemble à « sel » : une correspondance floue les exclurait de la
 * liste et Marc rentrerait sans ses poivrons. Ici l'erreur ne se voit pas à l'écran — elle
 * se découvre en cuisinant.
 */
const MOTS_DE_FOND = new Set(["sel", "poivre", "poivres"]);

/**
 * Ingrédients de fond reconnus SEULEMENT sur la forme exacte.
 *
 * « eau » ne peut pas être un mot-clé : « eau de fleur d'oranger » et « eau de rose » sont
 * de vrais achats. On n'exclut donc que l'eau qui est vraiment de l'eau.
 */
const FORMES_EXACTES = new Set([
  "eau",
  "eau froide",
  "eau chaude",
  "eau tiede",
  "eau bouillante",
  "glacons",
  "glace",
]);

export function estIngredientDeFond(canonical: string): boolean {
  const k = cle(canonical);
  if (!k) return false;
  if (FORMES_EXACTES.has(k)) return true;
  return k.split(" ").some((mot) => MOTS_DE_FOND.has(mot));
}

export interface ArticleFiltrable {
  name: string;
  canonical: string;
}

export interface TriDeFond<T> {
  /** Ce qui va vraiment sur la liste d'épicerie. */
  aAcheter: T[];
  /** Ce qui en a été écarté — gardé pour pouvoir le DIRE, jamais jeté en silence. */
  deFond: T[];
}

export function ecarterIngredientsDeFond<T extends ArticleFiltrable>(
  articles: readonly T[],
): TriDeFond<T> {
  const aAcheter: T[] = [];
  const deFond: T[] = [];
  for (const a of articles) (estIngredientDeFond(a.canonical) ? deFond : aAcheter).push(a);
  return { aAcheter, deFond };
}

/**
 * Phrase affichée sous la liste. Retourne `null` quand il n'y a rien à dire — un bandeau
 * permanent qui annonce « 0 ingrédient écarté » devient du bruit qu'on cesse de lire.
 *
 * Elle NOMME les ingrédients : « 3 ingrédients non listés » ne se vérifie pas, et ne
 * permettrait pas de repérer le jour où quelque chose est écarté à tort.
 */
export function resumerIngredientsDeFond(noms: readonly string[]): string | null {
  const uniques = [...new Set(noms.map((n) => n.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fr"),
  );
  if (uniques.length === 0) return null;
  const liste =
    uniques.length === 1
      ? uniques[0]
      : `${uniques.slice(0, -1).join(", ")} et ${uniques[uniques.length - 1]}`;
  return `${liste} ${uniques.length === 1 ? "n’est pas listé" : "ne sont pas listés"} : ces ingrédients ne s’achètent pas à la recette.`;
}
