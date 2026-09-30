// Rayons de l'épicerie : range chaque article de la liste dans un rayon APPROXIMATIF.
//
// ⚠️ Aucune donnée réelle ne dit où se trouve un ingrédient : dans le seed V3,
// `ingredient_master.category` et `subcategory` sont NULL sur les 15 389 lignes (mesuré le
// 30/09/2026). Le rayon est donc DÉRIVÉ du nom par une table de mots-clés fermée — comme le
// type de plat (`typePlat.ts`) : recalculé, jamais stocké, jamais saisi à la main. Pas de
// colonne en base : la base Neon est partagée par les préversions, et une donnée qui se dérive
// n'a rien à y faire.
//
// Règles :
// - correspondance en MOT ENTIER via `comparable()` (jamais par sous-chaîne : « persil » n'est
//   pas du « sel », « poivron » n'est pas du « poivre ») ;
// - singulier et pluriel confondus (s/x final retiré des deux côtés) ;
// - la PREMIÈRE règle qui correspond gagne : les exceptions (« lait de coco », « bouillon de
//   bœuf », « raisins secs ») passent donc avant les mots simples ;
// - ce qui ne correspond à rien va dans « Autres » : rien n'est perdu, rien n'est deviné.
//
// Mots tirés des canonicals les plus fréquents du vrai catalogue (top 260 du seed, 30/09/2026).
// MESURE du 30/09/2026 : 192 des 200 canonicals les plus fréquents rangés hors « Autres »
// (96 %), verrouillé en cliquet dans `tests/rayons.test.ts`.

import { comparable } from "./typePlat";

/** Ordre = ordre d'affichage (le parcours habituel d'un magasin québécois). */
export const RAYONS = [
  "Fruits et légumes",
  "Viandes et poissons",
  "Produits laitiers et œufs",
  "Boulangerie",
  "Épicerie",
  "Autres",
] as const;

export type Rayon = (typeof RAYONS)[number];

/**
 * Règles ORDONNÉES : la première qui correspond gagne. Chaque expression est écrite en
 * français lisible ; elle passe par la même normalisation que le texte comparé.
 */
const REGLES: readonly (readonly [Rayon, readonly string[]])[] = [
  // 1. Exceptions : un mot « frais » dans un produit d'épicerie, ou l'inverse.
  // On ne sait pas si la pâte à tarte est achetée surgelée, au frigo ou faite maison : Autres.
  ["Autres", ["pâte feuilletée", "pâte brisée", "pâte sablée", "feuille de brick"]],
  ["Viandes et poissons", ["fruits de mer"]],
  [
    "Épicerie",
    [
      "lait de coco", "crème de coco", "noix de coco", "beurre d'arachide", "beurre de cacahuète",
      // « bouillon » et pas « cube » : « bœuf en cubes » est de la viande.
      "lait concentré", "chocolat", "bouillon", "fond de", "sauce", "concentré", "coulis",
      "conserve", "poudre", "raisin sec", "fruit sec", "tomate séchée", "piment d'espelette",
      "eau de rose", "eau de fleur d'oranger", "herbes de provence", "laurier", "extrait",
      "arôme", "levure",
    ],
  ],
  // 2. Rayons frais.
  [
    "Viandes et poissons",
    [
      "boeuf", "veau", "porc", "agneau", "poulet", "dinde", "canard", "volaille", "viande",
      "jambon", "lardon", "bacon", "saucisse", "chorizo", "merguez", "steak", "magret",
      "escalope", "côtelette", "rôti", "saumon", "thon", "truite", "cabillaud", "morue",
      "aiglefin", "tilapia", "poisson", "crevette", "moule", "pétoncle", "homard", "crabe",
      "calmar", "anchois", "sardine",
    ],
  ],
  [
    "Produits laitiers et œufs",
    [
      "oeuf", "lait", "beurre", "crème", "fromage", "parmesan", "mozzarella", "mascarpone",
      "ricotta", "feta", "gruyère", "emmental", "comté", "chèvre", "cheddar", "brie",
      "camembert", "reblochon", "raclette", "halloumi", "burrata", "cottage", "yaourt",
      "yogourt", "margarine",
    ],
  ],
  [
    "Boulangerie",
    ["pain", "baguette", "brioche", "croissant", "pita", "tortilla", "pâte à pizza"],
  ],
  [
    "Fruits et légumes",
    [
      "oignon", "ail", "échalote", "carotte", "tomate", "citron", "lime", "courgette",
      "pomme de terre", "patate", "poivron", "piment", "champignon", "concombre", "avocat",
      "poireau", "banane", "aubergine", "orange", "framboise", "fraise", "bleuet", "myrtille",
      "persil", "basilic", "coriandre", "menthe", "ciboulette", "thym", "romarin", "aneth",
      "estragon", "sauge", "épinard", "laitue", "salade", "roquette", "chou", "chou-fleur",
      "brocoli", "céleri", "navet", "radis", "betterave", "courge", "potiron", "citrouille",
      "mangue", "kiwi", "ananas", "poire", "pomme", "raisin", "pêche", "abricot", "cerise",
      "prune", "melon", "pastèque", "gingembre", "haricot vert", "petit pois", "asperge",
      "artichaut", "fenouil", "endive", "cresson", "citronnelle", "légume", "fruit", "zeste",
    ],
  ],
  // 3. Épicerie sèche.
  [
    "Épicerie",
    [
      "sel", "poivre", "farine", "sucre", "cassonade", "huile", "vinaigre", "riz", "pâte",
      "spaghetti", "nouille", "quinoa", "lentille", "pois chiche", "haricot", "semoule",
      "couscous", "boulgour", "flocons d'avoine", "avoine", "maïzena", "fécule", "gélatine",
      "chapelure", "moutarde", "ketchup", "mayonnaise", "miel", "sirop", "confiture", "cacao",
      "vanille", "cannelle", "cumin", "curry", "curcuma", "paprika", "muscade", "girofle",
      "épice", "amande", "noisette", "noix", "pignon", "cacahuète", "arachide", "pistache",
      "sésame", "café", "thé", "vin", "rhum", "bière", "olive", "cornichon", "câpre",
      "biscuit", "spéculoos", "nutella", "bicarbonate", "tahini", "soja",
    ],
  ],
];

/** Retire le s/x final d'un mot de plus de 3 lettres : « oeufs » → « oeuf », « choux » → « chou ». */
function singulier(mot: string): string {
  return mot.length > 3 && /[sx]$/.test(mot) ? mot.slice(0, -1) : mot;
}

/** Forme normalisée bordée d'espaces : comparable() puis chaque mot au singulier. */
function normaliser(texte: string): string {
  const mots = comparable(texte).trim().split(" ").filter(Boolean).map(singulier);
  return mots.length > 0 ? ` ${mots.join(" ")} ` : " ";
}

// Normalisées une seule fois au chargement du module.
const REGLES_NORMALISEES = REGLES.map(
  ([rayon, mots]) => [rayon, mots.map((m) => normaliser(m))] as const,
);

function chercher(texte: string): Rayon | null {
  const t = normaliser(texte);
  if (t === " ") return null;
  for (const [rayon, mots] of REGLES_NORMALISEES) {
    if (mots.some((m) => t.includes(m))) return rayon;
  }
  return null;
}

/**
 * Rayon d'un article. Le canonical décide d'abord (clé de regroupement, toujours en
 * français) ; s'il ne dit rien (canonical de repli « ingredient »), le nom d'affichage.
 * Ne lève jamais d'exception : « Autres » par défaut.
 */
export function rayonDe(canonical: string, name: string): Rayon {
  return chercher(canonical) ?? chercher(name) ?? "Autres";
}
