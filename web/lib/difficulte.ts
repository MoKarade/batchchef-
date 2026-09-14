// La difficulté d'une recette, en étoiles (SEM-05). PUR : aucune I/O, aucune horloge.
//
// ⚠️ RIEN de tout ça n'existe dans la source. Mesuré le 14/09/2026 sur le seed :
// `difficulty` est NULL sur les 10 188 recettes, comme `meal_type` et
// `estimated_cost_per_portion`. La note est donc une ESTIMATION, et l'app le dit —
// même règle que le type de plat (SEM-01).
//
// ⚠️ Ce qui est mesuré est l'EFFORT, pas la TECHNIQUE. Trois signaux, et seulement
// trois : combien d'ingrédients, combien d'étapes, combien de temps. Une omelette
// roulée est techniquement difficile et sortira « très simple » — aucun signal du
// corpus ne dit le contraire, et l'inventer serait exactement ce que le reste de
// l'app s'interdit. Le libellé affiché parle donc d'exigence, jamais de savoir-faire.

export const ETOILES_MAX = 5;

/** Nombre de signaux nécessaires pour oser une note. En dessous : « non estimée ». */
export const SIGNAUX_MINIMUM = 2;

export type Difficulte = 1 | 2 | 3 | 4 | 5;

export interface RecetteADifficulte {
  /** Nombre de lignes d'ingrédients. 0 = la recette n'en porte aucune. */
  ingredients: number;
  /** Nombre d'étapes d'instructions (cf. `compterEtapes`). 0 = pas d'instructions. */
  etapes: number;
  /** Préparation + cuisson, en minutes. 0 = la source ne dit rien (cf. lib/tempsRecette.ts). */
  dureeMinutes: number;
}

export interface VerdictDifficulte {
  /** `null` quand moins de `SIGNAUX_MINIMUM` signaux sont disponibles. */
  etoiles: Difficulte | null;
  /** Combien des trois signaux ont pu être lus — sert à EXPLIQUER un `null`. */
  signaux: number;
}

export const LIBELLES_DIFFICULTE: Record<Difficulte, string> = {
  1: "Très simple",
  2: "Simple",
  3: "Moyenne",
  4: "Exigeante",
  5: "Très exigeante",
};

/**
 * Déciles MESURÉS sur le seed le 14/09/2026 (10 188 recettes), signal par signal, en
 * n'incluant que les recettes où le signal existe. Index 0 = minimum, index 10 = maximum.
 *
 * ⚠️ Ces échelles sont des MESURES, pas des préférences : elles se re-mesurent
 * (`scripts/mesurer-difficulte.ts`) plutôt que de se retoucher à la main. Un seuil
 * écrit avant sa mesure est un chiffre inventé.
 */
const DECILES = {
  ingredients: [1, 5, 6, 7, 7, 8, 9, 10, 11, 13, 41],
  etapes: [1, 3, 4, 5, 6, 7, 7, 8, 10, 12, 49],
  dureeMinutes: [1, 15, 20, 27, 33, 40, 45, 55, 60, 80, 4200],
} as const;

/**
 * Coupes du score composite, MESURÉES le 14/09/2026 : ce sont les quintiles observés sur
 * les 10 185 recettes notables du seed.
 *
 * ⚠️ Elles sont DÉRIVÉES du corpus, et c'est délibéré. Trois signaux corrélés,
 * moyennés, produisent une cloche : des seuils « ronds » écraseraient tout le monde sur
 * 2-3-4 et les étoiles 1 et 5 seraient décoratives. Avec ces coupes, la distribution
 * mesurée est 19,9 / 19,8 / 20,2 / 20,0 / 20,0 % — les cinq niveaux existent vraiment.
 *
 * Conséquence à DIRE à l'écran : l'échelle est RELATIVE au catalogue. Une étoile veut
 * dire « parmi les plus simples du catalogue », pas « facile dans l'absolu ».
 */
const COUPES = [0.2905, 0.4333, 0.5595, 0.6988] as const;

/**
 * Compte les étapes d'un texte d'instructions. Une ligne de deux caractères ou moins
 * (numéro orphelin, puce) n'est pas une étape.
 */
export function compterEtapes(instructions: string | null | undefined): number {
  if (!instructions) return 0;
  return instructions
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 2).length;
}

/**
 * Position d'une valeur dans son échelle de déciles, interpolée, bornée à [0, 1].
 * Un décile plat (deux ancres égales) ne divise jamais par zéro.
 */
function rang(valeur: number, ancres: readonly number[]): number {
  const bas = ancres[0] ?? 0;
  const haut = ancres[ancres.length - 1] ?? 0;
  if (valeur <= bas) return 0;
  if (valeur >= haut) return 1;
  for (let i = 0; i < ancres.length - 1; i++) {
    const a = ancres[i] ?? 0;
    const b = ancres[i + 1] ?? 0;
    if (valeur <= b) {
      const largeur = b - a;
      return (i + (largeur === 0 ? 0 : (valeur - a) / largeur)) / (ancres.length - 1);
    }
  }
  return 1;
}

/**
 * La note en étoiles, ou `null` si moins de deux signaux sont lisibles.
 *
 * ⚠️ Un signal ABSENT ne vaut pas zéro : il est retiré de la moyenne. Le compter comme
 * « 0 ingrédient » ferait passer une recette non renseignée pour la plus simple du
 * catalogue — un manque déguisé en mesure.
 */
export function estimerDifficulte(r: RecetteADifficulte): VerdictDifficulte {
  const parts: number[] = [];
  if (r.ingredients > 0) parts.push(rang(r.ingredients, DECILES.ingredients));
  if (r.etapes > 0) parts.push(rang(r.etapes, DECILES.etapes));
  if (r.dureeMinutes > 0) parts.push(rang(r.dureeMinutes, DECILES.dureeMinutes));

  if (parts.length < SIGNAUX_MINIMUM) return { etoiles: null, signaux: parts.length };

  const score = parts.reduce((a, b) => a + b, 0) / parts.length;
  let etoiles: Difficulte = 5;
  for (let i = 0; i < COUPES.length; i++) {
    if (score < (COUPES[i] ?? 1)) {
      etoiles = (i + 1) as Difficulte;
      break;
    }
  }
  return { etoiles, signaux: parts.length };
}

/** Garde de type pour une valeur relue de la base (colonne `integer` nullable). */
export function estDifficulte(valeur: unknown): valeur is Difficulte {
  return typeof valeur === "number" && Number.isInteger(valeur) && valeur >= 1 && valeur <= ETOILES_MAX;
}
