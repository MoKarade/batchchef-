// Temps de préparation et de cuisson (CAT-C). Module PUR : aucune base, aucun I/O.
//
// La donnée existait depuis le début dans le seed — `prep_time_min` et `cook_time_min`,
// renseignés pour les 10 188 recettes — et n'avait JAMAIS été importée. Une fiche ne disait
// donc rien du temps que la recette demande, alors que c'est le premier critère quand on
// choisit quoi cuisiner un mardi soir.
//
// DEUX DÉFAUTS MESURÉS AVANT DE L'IMPORTER, parce qu'afficher une donnée fausse est pire
// que ne rien afficher :
//
//   1. DES MINUTES LUES COMME DES HEURES — 71 valeurs. « Funky Pop Corn » annonce 1 800 min
//      de préparation, soit trente heures ; 1 800 = 30 × 60. Preuve que ce n'est pas une
//      coïncidence : 71 des 75 valeurs supérieures à 12 h sont des multiples EXACTS de 60,
//      contre 3,8 % seulement des valeurs plausibles — un enrichissement de 25×. Et tous les
//      quotients retombent sur des durées de cuisine ordinaires (30, 20, 15, 40, 25 min…).
//      Les 4 valeurs restantes ne sont pas des multiples de 60 : on n'y touche pas.
//
//   2. ZÉRO NE VEUT PAS DIRE « INSTANTANÉ » — 224 recettes annoncent 0 en préparation ET 0
//      en cuisson, dont « Gâteau à la vapeur au chocolat » et « Homard à l'armoricaine ».
//      C'est une donnée MANQUANTE, pas une recette qui se fait toute seule. Elle ne s'affiche
//      donc pas. Un 0 en cuisson SEUL, lui, est crédible (tiramisu, salade) et se dit.

/** Au-delà, ce n'est plus une durée de recette mais une erreur d'unité. */
const SEUIL_ABERRANT = 720;

/**
 * La durée telle qu'elle aurait dû être enregistrée.
 *
 * ⚠️ On ne corrige QUE le cas prouvé : au-delà du seuil ET multiple exact de 60. Une valeur
 * aberrante qui ne l'est pas (1 451, 870, 1 830) reste intacte — rien ne dit ce qu'elle
 * devrait valoir, et une marinade de 24 h existe.
 */
export function tempsCorrige(minutes: number | null | undefined): number | null {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) return null;
  if (minutes > SEUIL_ABERRANT && minutes % 60 === 0) return minutes / 60;
  return minutes;
}

/** « 1 h 25 », « 45 min », « 2 h ». Rend `null` quand il n'y a rien d'honnête à dire. */
export function formatDuree(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

export interface DureesAffichables {
  preparation: string | null;
  cuisson: string | null;
  total: string | null;
}

/**
 * Ce qu'on affiche, à partir des deux durées BRUTES du seed.
 *
 * ⚠️ Les deux à zéro ⇒ RIEN. C'est le cas des 224 recettes sans donnée : afficher
 * « 0 min » leur ferait dire quelque chose de faux, et « total : 0 min » encore plus.
 */
export function dureesAffichables(
  prep: number | null | undefined,
  cuisson: number | null | undefined,
): DureesAffichables {
  const p = tempsCorrige(prep) ?? 0;
  const c = tempsCorrige(cuisson) ?? 0;
  if (p <= 0 && c <= 0) return { preparation: null, cuisson: null, total: null };
  return {
    preparation: formatDuree(p),
    cuisson: formatDuree(c),
    total: formatDuree(p + c),
  };
}
