// Lecture du TEXTE SOURCE d'un ingrédient (`raw_text` du catalogue V3), pour corriger ce que
// l'extraction d'origine a abîmé — les noms ET les unités.
//
// LE DÉFAUT COMMUN, une seule cause : l'app V3 cherchait l'unité en tête de texte SANS
// frontière de mot. Elle a donc reconnu `g` dans « gousses », `cl` dans « clous », `l` dans
// « lamelles », `de` dans « demis » — et retiré ces lettres du nom tout en enregistrant une
// unité de MASSE là où le texte parlait de PIÈCES.
//
// Deux conséquences, de gravités différentes :
//   - le NOM perd ses premières lettres (« Ousses D'Ail », « Ous De Girofle ») — laid, et il
//     casse le regroupement de la liste d'épicerie ;
//   - l'UNITÉ devient fausse (« Gousses D'Ail — 3 g ») — et là, c'est ce que Marc ACHÈTE qui
//     est faux : 3 g d'ail, c'est une demi-gousse quand il en faut trois.
//
// ⚠️ LE RISQUE À NE PAS PRENDRE : « 200 g de gingembre » est parfaitement légitime. Convertir
// aveuglément tout `g` en pièces transformerait 200 grammes en 200 unités. La correction
// n'est donc appliquée que lorsque TOUTES les lignes source d'un même ingrédient s'accordent
// à dire un dénombrable — mesuré sur le corpus : 325 clés concernées, 0 ambiguë.
//
// Module PUR : aucune base, aucun fichier, aucun réseau.

/** Unités de masse ou de volume : les seules qui justifient `g`/`ml`. */
const REELLES = new Set([
  "g", "gramme", "grammes", "kg", "kilo", "kilos", "kilogramme", "kilogrammes", "mg",
  "ml", "millilitre", "millilitres", "cl", "dl", "l", "litre", "litres",
  "centilitre", "centilitres", "decilitre", "décilitre", "decilitres", "décilitres",
]);

/**
 * Mots DÉNOMBRABLES que l'extraction V3 a mordus. Ce sont des pièces, jamais des grammes.
 *
 * Liste FERMÉE et dérivée du corpus, pas devinée : chaque entrée correspond à un dégât
 * réellement mesuré dans `data/batchchef.seed.db`. En ajouter un au hasard élargirait la
 * conversion à des cas qu'on n'a pas regardés.
 */
const COMPTABLES = new Set([
  "gousse", "gousses", "clou", "clous", "goutte", "gouttes", "grosse", "grosses",
  "glaçon", "glaçons", "glacon", "glacons", "graine", "graines", "grappe", "grappes",
  "lamelle", "lamelles", "demi", "demis", "tranche", "tranches", "branche", "branches",
  "feuille", "feuilles", "brin", "brins", "pincée", "pincées", "pincee", "pincees",
  "filet", "filets",
]);

/** Les plus LONGS d'abord : « grammes » avant « g », sinon on remord dans le mot. */
const TOUS = [...REELLES, ...COMPTABLES].sort((a, b) => b.length - a.length);

/**
 * La quantité en tête. Tolère un SIGNE et une approximation.
 *
 * ⚠️ Le `-?` n'est pas cosmétique : le corpus contient « -1 gousses d'ail ». Sans lui, la
 * quantité n'était pas retirée, le texte ne commençait donc par aucune unité reconnue, et
 * l'ingrédient passait pour « indéterminé ». Conséquence mesurée : la clé de l'ail entrait
 * en désaccord avec elle-même et se faisait écarter — c'est-à-dire précisément le cas le
 * plus fréquent du corpus (1 482 lignes) qui échappait au correctif.
 */
const QUANTITE = /^\s*(?:~|environ\s+)?-?\d+(?:[.,/]\d+)?(?:\s*(?:à|-|a)\s*\d+(?:[.,/]\d+)?)?\s*/i;

export type ClasseUnite = "reelle" | "comptable" | "aucune";

function echapper(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Que dit VRAIMENT le texte source, juste après la quantité ?
 *
 * ⚠️ La frontière de mot (`\b`) est tout le correctif : c'est son absence qui a produit
 * l'ensemble du dégât. Ne jamais la retirer « pour simplifier ».
 */
export function analyserTexteSource(raw: string): { classe: ClasseUnite; mot: string | null } {
  const s = raw.trim().replace(QUANTITE, "").toLowerCase();
  for (const u of TOUS) {
    if (new RegExp(`^${echapper(u)}\\b`).test(s)) {
      return { classe: REELLES.has(u) ? "reelle" : "comptable", mot: u };
    }
  }
  return { classe: "aucune", mot: null };
}

/**
 * L'unité enregistrée est-elle une unité de masse/volume ? (Donc contredite par un texte
 * source qui parle de pièces.)
 */
export function estUniteDeMesure(unite: string | null): boolean {
  return unite === "g" || unite === "ml";
}

/**
 * Décide de l'unité correcte pour un ingrédient, d'après TOUTES ses lignes source.
 *
 * Rend `null` quand il n'y a rien à corriger — y compris, et surtout, quand les lignes se
 * CONTREDISENT : c'est le cas « 200 g de gingembre » contre « 1 gingembre », où se tromper
 * coûte cent fois plus que de ne rien faire.
 */
export function uniteCorrigee(
  uniteActuelle: string | null,
  textesSource: string[],
): "unite" | null {
  if (!estUniteDeMesure(uniteActuelle)) return null;
  if (textesSource.length === 0) return null;
  const classes = new Set(textesSource.map((t) => analyserTexteSource(t).classe));
  return classes.size === 1 && classes.has("comptable") ? "unite" : null;
}

/**
 * Mots d'unité à ignorer QUAND ON CHERCHE LE NOM de l'ingrédient.
 *
 * ⚠️ Liste distincte de `COMPTABLES` à dessein : celle-ci ne sert qu'à savoir où commence
 * l'ingrédient dans le texte, jamais à décider d'une unité. Les confondre ferait qu'ajouter
 * un mot pour mieux lire un nom changerait au passage des quantités — deux décisions
 * différentes ne partagent pas une liste.
 */
const MOTS_UNITE_POUR_LE_NOM = [
  ...REELLES, ...COMPTABLES,
  "tasse", "tasses", "verre", "verres", "bol", "bols", "sachet", "sachets",
  "boîte", "boîtes", "boite", "boites", "cuillère", "cuillères", "cuillere", "cuilleres",
  "cuillerée", "cuillerées", "paquet", "paquets", "pot", "pots", "cube", "cubes",
  "gros", "grosse", "grosses", "grand", "grande", "grandes", "petit", "petite", "petites",
  "beau", "beaux", "belle", "belles", "haché", "hachés", "hachée", "hachées",
].sort((a, b) => b.length - a.length);

/** Le texte débarrassé de sa quantité et de son unité de tête : l'INGRÉDIENT seul. */
function sansQuantiteNiUnite(raw: string): string {
  let s = raw.trim().replace(QUANTITE, "");
  // Plusieurs mots d'unité s'enchaînent parfois : « 1 grandes cuillères de sirop ».
  // Trois tours suffisent largement et bornent la boucle.
  for (let tour = 0; tour < 3; tour++) {
    const avant = s;
    for (const u of MOTS_UNITE_POUR_LE_NOM) {
      if (new RegExp(`^${echapper(u)}\\b`, "i").test(s)) {
        s = s.slice(u.length).replace(/^\s*(?:de\s+|d'|d’|du\s+|des\s+|à\s+)/i, "").trim();
        break;
      }
    }
    if (s === avant) break;
  }
  return s.replace(/^\s*(?:de\s+|d'|d’|du\s+|des\s+)/i, "").trim();
}

/**
 * Restaure les lettres mangées en tête de nom, en cherchant dans le texte source le mot dont
 * le nom ne garde qu'un SUFFIXE (« Ousses » ← « gousses », « Es » ← « fraises »).
 *
 * ⚠️ ON CHERCHE DEUX FOIS, ET L'ORDRE EST TOUT.
 *
 * D'abord dans la partie INGRÉDIENT (quantité et unité retirées) : sans ça,
 * « 1/2 tasses de fraises » restaure « Es » en « Tasses » — le premier mot en `-es` du
 * texte est l'unité, pas l'ingrédient. Cette fausse restauration entrait en conflit avec la
 * bonne venue d'une autre source, et le conflit annulait les DEUX : 198 lignes abîmées à
 * cause d'une seule mal lue.
 *
 * Puis, si rien n'est trouvé, dans le texte ENTIER : parce que le mot amputé EST parfois
 * l'unité elle-même (« Rosses » ← « grosses », « Amelles » ← « lamelles »). Mesuré : ne
 * chercher que dans la partie ingrédient perdait 595 restaurations qui marchaient.
 *
 * Conservateur par construction : on ne restitue que ce que la source contient réellement,
 * et seulement si le mot retrouvé se termine EXACTEMENT par le fragment. Rend le nom
 * inchangé au moindre doute — un nom laid vaut mieux qu'un nom inventé.
 */
export function nomRestaure(nom: string, textesSource: string[]): string {
  const premier = nom.trim().split(/\s+/)[0];
  if (!premier || premier.length < 2) return nom;
  const bas = premier.toLowerCase();
  // ⚠️ Frontière EXPLICITE, pas `\b` : en JS, `è`/`é` ne sont pas des lettres, donc `\b`
  // se déclenche au milieu des mots accentués et fabrique de faux appariements.
  const motif = new RegExp(`(?:^|[\\s'’(])(\\w*${echapper(bas)})\\b`, "i");
  // Combien de lettres a-t-on le droit de rendre ? Trois en général — au-delà, ce n'est plus
  // une troncature mais un autre mot.
  //
  // ⚠️ Exception étroite : un fragment de DEUX lettres n'est jamais un mot en soi, donc le
  // mot d'origine est forcément bien plus long (« Es » ← « fraises », cinq lettres rendues).
  // Le seuil s'arrête à deux et pas à trois, et c'est mesuré : à trois, « Ail » deviendrait
  // « Portail » — un vrai mot français transformé en un autre. Un test le verrouille.
  const budget = premier.length <= 2 ? 5 : 3;

  for (const ou of ["ingredient", "entier"] as const) {
    for (const raw of textesSource) {
      const texte = ou === "ingredient" ? sansQuantiteNiUnite(raw) : raw;
      const trouve = motif.exec(` ${texte}`)?.[1];
      if (!trouve || trouve.length <= premier.length) continue;
      if (trouve.length - premier.length > budget) continue;
      const restaure = trouve[0]!.toUpperCase() + trouve.slice(1);
      return nom.replace(premier, restaure);
    }
  }
  return nom;
}

/**
 * Retire une préposition restée SEULE en fin de nom (« Huile végétale pure à »).
 *
 * Ces noms viennent d'un référentiel produit et ont été coupés en pleine phrase. La
 * préposition finale ne désigne rien : « Huile végétale pure à » ne dit pas à quoi. La
 * retirer rend un nom court et vrai plutôt qu'une phrase inachevée.
 *
 * ⚠️ Frontière explicite plutôt que `\b` : en JS, `è` n'est pas une lettre, donc /\bde$/
 * matche la fin de « Tiède » et amputerait un nom parfaitement correct. Ce faux positif a
 * été mesuré sur le corpus avant d'être écarté.
 *
 * ⚠️ Ne rend jamais une chaîne vide, et ne touche pas un nom d'un seul mot : « De » seul
 * n'est pas un nom qu'on améliore en le vidant.
 */
const PREPOSITION_FINALE = /(?:^|[\s'’])(?:à|de|d'|d’|en|au|aux|pour|sur|avec|dans)\s*$/i;

export function nomSansPrepositionFinale(nom: string): string {
  const t = nom.trim();
  if (t.split(/\s+/).length < 2) return nom;
  const coupe = t.replace(PREPOSITION_FINALE, "").trim();
  return coupe.length > 0 ? coupe : nom;
}
