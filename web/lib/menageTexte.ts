// Ménage du TEXTE AFFICHÉ (CAT-D). Module PUR : aucune base, aucun I/O.
//
// ⚠️ FRONTIÈRE AVEC CAT-B, à ne pas franchir : la recherche normalise ce qu'elle COMPARE,
// dans une colonne dérivée, sans jamais toucher au texte d'origine. Ici on corrige ce qui
// s'AFFICHE. Confondre les deux réécrirait des titres pour une raison de recherche.
//
// L'INVENTAIRE A ÉTÉ REFAIT AVANT DE CODER, et il a démenti trois de mes cinq items :
//
//   - « 6 instructions avec du mojibake » : il y en a ZÉRO. Mon détecteur cherchait
//     `Ã|Â|â€`, qui attrape les « À » et « Â » parfaitement légitimes d'un corpus français.
//     Le compte mesurait mon motif, pas le corpus.
//   - « 7 titres de plus de 120 caractères » : ce sont de vrais titres de plats
//     gastronomiques (« Socca cuite au barbecue, houmous de pois chiches, Burrata… »).
//     Longs, pas abîmés.
//   - « 71 instructions sans saut de ligne » : 37 font moins de 200 caractères et sont des
//     recettes en UNE étape (« Mélanger les ingrédients et servir bien frais »). Une seule
//     dépasse 600 caractères. Re-segmenter serait inventer une structure absente.
//
// Reste ce qui est vraiment abîmé : les entités HTML (1 titre, 28 instructions), les
// espaces doubles (23 titres), les accents décomposés (32) et les invisibles (149).

/**
 * Entités décodées. Liste FERMÉE : on ne décode que ce qu'on a VU dans le corpus, plutôt
 * qu'un décodeur général qui transformerait un « &copy » écrit à la main en symbole.
 *
 * ⚠️ `&amp;` EN DERNIER, toujours : décodé en premier, il transformerait `&amp;quot;` en
 * `&quot;` puis en `"`, c'est-à-dire un guillemet là où la source écrivait le texte
 * `&quot;`. C'est la règle classique du double décodage.
 */
const ENTITES: ReadonlyArray<readonly [string, string]> = [
  ["&quot;", '"'],
  ["&apos;", "'"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&nbsp;", " "],
  ["&#39;", "'"],
  ["&#34;", '"'],
  ["&amp;", "&"],
];

/** Caractères invisibles retirés : ils ne se voient pas et cassent toute comparaison. */
const INVISIBLES = /[️​‌‍]/g;

/**
 * Le texte tel qu'il devrait s'afficher.
 *
 * ⚠️ L'ESPACE INSÉCABLE EST CONSERVÉ. Il y en a 325 dans le corpus, et en typographie
 * française il est CORRECT devant `; : ! ?` et à l'intérieur des guillemets. Le remplacer
 * par une espace ordinaire abîmerait un texte juste — c'est exactement le genre de « ménage »
 * qui casse plus qu'il ne répare. Seules les suites d'espaces ORDINAIRES sont réduites.
 */
export function nettoyerTexte(texte: string | null | undefined): string | null {
  if (texte === null || texte === undefined) return null;
  let s = texte;
  for (const [entite, valeur] of ENTITES) s = s.split(entite).join(valeur);
  s = s.replace(INVISIBLES, "");
  // NFC recompose « a + accent combinant » en « â » : identique à l'œil, mais un seul
  // caractère, donc comparable et copiable.
  s = s.normalize("NFC");
  s = s.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** `true` quand le ménage changerait quelque chose — sert à n'écrire que le nécessaire. */
export function aBesoinDeMenage(texte: string | null | undefined): boolean {
  if (texte === null || texte === undefined) return false;
  return nettoyerTexte(texte) !== texte;
}
