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
 * Restaure les lettres mangées en tête de nom, en cherchant dans le texte source le mot dont
 * le nom ne garde qu'un SUFFIXE (« Ousses » ← « gousses », « Ous » ← « clous »).
 *
 * Conservateur par construction : on ne restitue que ce que la source contient réellement, et
 * seulement si le mot retrouvé se termine EXACTEMENT par le mot abîmé. Rend le nom inchangé
 * dès que le moindre doute existe — un nom laid vaut mieux qu'un nom inventé.
 */
export function nomRestaure(nom: string, textesSource: string[]): string {
  const premier = nom.trim().split(/\s+/)[0];
  if (!premier || premier.length < 2) return nom;
  const bas = premier.toLowerCase();
  for (const raw of textesSource) {
    const m = new RegExp(`\\b(\\w*${echapper(bas)})\\b`, "i").exec(raw);
    const trouve = m?.[1];
    if (!trouve || trouve.length <= premier.length) continue;
    // Au plus trois lettres perdues : au-delà, ce n'est plus une troncature mais un autre mot.
    if (trouve.length - premier.length > 3) continue;
    const restaure = trouve[0]!.toUpperCase() + trouve.slice(1);
    return nom.replace(premier, restaure);
  }
  return nom;
}
