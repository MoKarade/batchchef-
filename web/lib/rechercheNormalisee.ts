// Normalisation du texte POUR LA RECHERCHE (CAT-B). Module PUR : aucune base, aucun I/O.
//
// LE PROBLÈME MESURÉ, sur les 10 188 titres et 15 389 noms d'ingrédients du catalogue :
// la recherche compare le texte brut (`ILIKE '%q%'`), donc elle rate tout ce que
// l'utilisateur ne tape pas exactement comme c'est stocké.
//
//   « creme »  →  1 recette trouvée sur 346        « pate »  →  0 sur 312
//   « gateau » →  18 sur 395                       « crepe » →  0 sur 114
//
// ⚠️ ET L'ACCENT N'EST NI LE SEUL COUPABLE NI LE PIRE. Le recensement des 60 caractères
// non-ASCII du corpus a déplacé la cible :
//
//   - L'APOSTROPHE TYPOGRAPHIQUE `’` : 340 noms d'ingrédient et 240 titres. Personne ne tape
//     ce caractère — « d'ail » au clavier droit ne trouve donc JAMAIS « d’ail ».
//   - LES ACCENTS DÉCOMPOSÉS (NFD) : 20 titres, 12 noms. « Pâte » y est stocké `P` + `a` +
//     accent combinant. Identique à l'œil, différent à l'octet : raté par la recherche ET
//     par toute détection de doublons.
//   - LES CARACTÈRES INVISIBLES : 149 sélecteurs de variante `U+FE0F`, 325 espaces
//     insécables. Invisibles à la relecture, bloquants à la comparaison.
//   - LES MARQUES DÉPOSÉES `®™©` : 587 noms, 226 titres. « Kub Or Maggi » rate
//     « Kub® Or Maggi® ».
//   - `œ`/`æ` : 157 occurrences. Elles se DÉVELOPPENT en deux lettres, ce qu'un remplacement
//     caractère par caractère ne sait pas faire.
//
// ⚠️ LA MÊME RÈGLE DOIT VIVRE DES DEUX CÔTÉS : dans Postgres (la colonne dérivée) et ici (la
// requête de l'utilisateur). Deux implémentations d'une même règle, c'est une règle et demie
// — et celle qui diverge silencieusement fait disparaître des résultats sans rien signaler.
// D'où le parti pris de ce fichier : les CONSTANTES ci-dessous sont l'unique source, et
// l'expression SQL est FABRIQUÉE à partir d'elles (`expressionSql`), jamais recopiée à la
// main dans la migration. Un tripwire compare la migration au texte fabriqué.

/** Développements 1 → N caractères. `translate` ne sait pas les faire : ils passent par `replace`. */
export const DEVELOPPEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["œ", "oe"],
  ["æ", "ae"],
  ["Œ", "oe"],
  ["Æ", "ae"],
];

/**
 * Caractères RETIRÉS purement et simplement.
 *
 * Les accents n'y figurent pas : la décomposition NFD les sépare de leur lettre, et ce sont
 * les marques combinantes (U+0300-U+036F) qui sont retirées ici. C'est ce qui rend la règle
 * GÉNÉRIQUE — aucune liste de lettres accentuées à tenir à jour, donc aucune lettre oubliée.
 */
export const A_RETIRER: readonly string[] = [
  // Marques combinantes des accents (après décomposition NFD).
  "̀", "́", "̂", "̃", "̄", "̆", "̇", "̈",
  "̊", "̋", "̌", "̧", "̨",
  // Invisibles.
  "️", "​", "‌", "‍",
  // Marques déposées.
  "®", "™", "©",
];

/** Caractères REMPLACÉS par un autre, de même longueur (donc `translate`-ables). */
export const EQUIVALENCES: ReadonlyArray<readonly [string, string]> = [
  ["’", "'"], ["‘", "'"], ["`", "'"], ["´", "'"],
  [" ", " "], [" ", " "], [" ", " "],
  ["“", '"'], ["”", '"'], ["«", '"'], ["»", '"'],
  ["–", "-"], ["—", "-"],
];

/**
 * Le texte tel qu'on le COMPARE. Ne change jamais ce qui est AFFICHÉ — c'est la frontière
 * avec le ménage du texte (CAT-D), qui corrige la colonne d'origine.
 */
export function normaliserPourRecherche(texte: string): string {
  let s = texte ?? "";
  for (const [de, vers] of DEVELOPPEMENTS) s = s.split(de).join(vers);
  s = s.normalize("NFD");
  for (const c of A_RETIRER) s = s.split(c).join("");
  for (const [de, vers] of EQUIVALENCES) s = s.split(de).join(vers);
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * L'expression SQL équivalente, FABRIQUÉE depuis les mêmes constantes.
 *
 * Uniquement des fonctions IMMUTABLES (`normalize`, `lower`, `translate`, `replace`,
 * `btrim`, `regexp_replace`) : c'est la condition pour qu'une colonne générée les accepte,
 * et ça évite l'extension `unaccent` — qui n'est PAS immuable (elle lit un dictionnaire) et
 * demanderait un privilège d'installation sur Neon.
 *
 * Une colonne GÉNÉRÉE plutôt qu'une colonne remplie par du code : un chemin d'insertion ne
 * peut pas oublier de la remplir. C'est exactement le défaut qui a fait perdre une colonne
 * quatre fois de suite chez JobAI — quatre `INSERT` recopiés, un champ neuf oublié partout.
 */
export function expressionSql(colonne: string): string {
  let expr = colonne;
  for (const [de, vers] of DEVELOPPEMENTS) expr = `replace(${expr}, ${litteral(de)}, ${litteral(vers)})`;
  expr = `normalize(${expr}, NFD)`;
  expr = `translate(${expr}, ${litteral(A_RETIRER.join(""))}, '')`;
  expr = `translate(${expr}, ${litteral(EQUIVALENCES.map(([d]) => d).join(""))}, ${litteral(EQUIVALENCES.map(([, v]) => v).join(""))})`;
  return `btrim(regexp_replace(lower(${expr}), '\\s+', ' ', 'g'))`;
}

/** Littéral SQL : les apostrophes se doublent, et l'invisible s'écrit en échappement lisible. */
function litteral(s: string): string {
  const echappe = [...s]
    .map((c) => (c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 0x300 && c.charCodeAt(0) <= 0x36f) || c.charCodeAt(0) === 0xfe0f || (c.charCodeAt(0) >= 0x200b && c.charCodeAt(0) <= 0x200d) || c.charCodeAt(0) === 0xa0 || c.charCodeAt(0) === 0x202f || c.charCodeAt(0) === 0x2009
      ? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
      : c === "'" ? "''" : c))
    .join("");
  return `E'${echappe}'`;
}
