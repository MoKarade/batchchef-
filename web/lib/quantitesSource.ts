// Reconstruit la QUANTITÉ d'un ingrédient depuis son texte source (`raw_text` du seed V3),
// là où l'extraction d'origine s'est trompée. Module PUR : aucune base, aucun fichier.
//
// TROIS DÉGÂTS MESURÉS sur les 87 444 lignes du seed, tous invisibles jusqu'ici parce que la
// valeur produite reste un nombre plausible :
//
//   1. UNE FRACTION EN TÊTE EST LUE « 1 » — 2 508 lignes. « 1/2 kg de viande hachée » a été
//      enregistré comme 1 kg : Marc achète le DOUBLE. Le dégât est proportionnel au
//      dénominateur (×2 pour un demi, ×4 pour un quart), et il est silencieux.
//   2. AUCUN NOMBRE DANS LA SOURCE, ET POURTANT UNE QUANTITÉ — 10 900 lignes. « huile »,
//      « riz pour l'accompagnement », « quelques feuilles de menthe » sont devenus « 1 ».
//      Un « 1 » affirme ; l'absence admet. Cas extrême du même bug de frontière de mot que
//      les noms : « légumes en bâtonnets » a produit **1 litre** (le `l` de « légumes »).
//   3. LA SENTINELLE 0,0001 — la V3 la posait quand elle renonçait. Arrondie à deux
//      décimales, elle s'affiche « 0 », c'est-à-dire une affirmation fausse.
//
// LA CLÉ DE LA RECONSTRUCTION : le seed stocke une quantité PAR PORTION, obtenue en divisant
// le nombre du texte par le rendement de la recette. Ce rendement n'est stocké nulle part
// (`recipe.servings` vaut 1 partout), mais il se RETROUVE : c'est le rapport
// `nombre du texte / quantité par portion`, et il doit être le MÊME sur toutes les lignes
// d'une recette. Les lignes qui s'en écartent sont exactement les lignes abîmées.
//
// ⚠️ ON NE CORRIGE QUE CE QU'ON SAIT EXPLIQUER. Un écart au rendement qui ne relève d'aucun
// des trois dégâts ci-dessus n'est PAS corrigé : il peut aussi bien venir de mon propre
// lecteur de nombres que de la V3, et rien ne permet de trancher. Une correction « au
// jugé » sur une donnée qui décide de ce que Marc achète serait pire que le défaut.

import { normalizeQty } from "./units";

/** Rendements admissibles pour une recette. Au-delà, le chiffre n'est plus un rendement. */
const RENDEMENT_MAX = 40;

/** Part des lignes qui doivent s'accorder pour qu'un rendement fasse foi. */
const MAJORITE = 0.6;

/**
 * Le nombre en tête du texte source.
 *
 * Tolère l'approximation (« ~ », « environ »), la virgule décimale, la fraction (« 1/2 »)
 * et le mixte (« 1 1/2 »).
 *
 * ⚠️ UN TIRET EN TÊTE EST UNE PUCE DE LISTE, PAS UN SIGNE. Le corpus porte « -1 gousses
 * d'ail » et « -4600 g de pomme de terre » : ce sont des lignes de liste dont le scrape a
 * collé le tiret au chiffre. Le lire comme un moins produisait une quantité négative, donc
 * un « défaut » là où la V3 avait raison — 43 faux positifs dans mon propre audit avant
 * correction. Une quantité négative n'existe pas dans une recette.
 *
 * ⚠️ Une FOURCHETTE (« 2 à 3 cuillères ») n'est pas un nombre : on rend `null` plutôt que
 * d'en choisir un bout. La V3 a pu prendre l'une ou l'autre borne, et l'écart qui en résulte
 * ne prouve rien — c'est précisément le cas où une « correction » inventerait une certitude.
 */
export function nombreEnTete(raw: string): { valeur: number | null; fraction: boolean } {
  const s = (raw ?? "").trim().replace(/^-\s*/, "").replace(/^(?:~|environ)\s*/i, "");
  const mixte = /^(\d+)\s+(\d+)\s*\/\s*(\d+)/.exec(s);
  if (mixte) {
    const [, e, n, d] = mixte;
    const den = Number(d);
    if (den === 0) return { valeur: null, fraction: false };
    return { valeur: Number(e) + Number(n) / den, fraction: true };
  }
  const frac = /^(\d+)\s*\/\s*(\d+)/.exec(s);
  if (frac) {
    const den = Number(frac[2]);
    if (den === 0) return { valeur: null, fraction: false };
    return { valeur: Number(frac[1]) / den, fraction: true };
  }
  const simple = /^(\d+(?:[.,]\d+)?)/.exec(s);
  const tete = simple?.[1];
  if (tete === undefined) return { valeur: null, fraction: false };
  // Fourchette : « 2 à 3 », « 2-3 », « 2 ou 3 ». On refuse de choisir.
  if (new RegExp(`^${tete.replace(".", "\\.")}\\s*(?:à|a|-|ou)\\s*\\d`, "i").test(s)) {
    return { valeur: null, fraction: false };
  }
  const v = Number(tete.replace(",", "."));
  return { valeur: Number.isFinite(v) ? v : null, fraction: false };
}

export interface LigneSource {
  raw: string;
  /** `quantity_per_portion` du seed. */
  qpp: number | null;
  /** `unit` du seed, telle quelle (« cuillères », « cl », « unite »…). */
  unite?: string | null;
}

/**
 * Le rendement de la recette, retrouvé par le rapport `nombre du texte / quantité par
 * portion`, à condition qu'une MAJORITÉ des lignes s'accorde et que le résultat ressemble à
 * un rendement (entier, de 1 à 40).
 *
 * `null` quand rien ne s'impose : la recette est alors laissée intacte. C'est le cas des
 * 89 recettes dont la V3 a divisé tout le contenu par un nombre absurde (500, 1 250,
 * 10 000) — leurs quantités sont fausses, mais le vrai rendement n'est plus nulle part et
 * l'inventer serait de la donnée fabriquée.
 */
export function rendementRecette(lignes: LigneSource[]): number | null {
  const rapports: number[] = [];
  for (const l of lignes) {
    const { valeur } = nombreEnTete(l.raw);
    if (valeur === null || valeur <= 0) continue;
    if (l.qpp === null || !Number.isFinite(l.qpp) || l.qpp <= 0) continue;
    rapports.push(valeur / l.qpp);
  }
  if (rapports.length === 0) return null;

  const votes = new Map<number, number>();
  for (const r of rapports) {
    const arrondi = Math.round(r);
    // Tolérance relative : la V3 a stocké des quotients arrondis à quatre décimales, donc
    // 1/6 vaut 0,1667 et le rapport retombe sur 5,999 — c'est bien un rendement de 6.
    if (arrondi < 1 || arrondi > RENDEMENT_MAX) continue;
    if (Math.abs(r - arrondi) > 0.01 * arrondi) continue;
    votes.set(arrondi, (votes.get(arrondi) ?? 0) + 1);
  }
  if (votes.size === 0) return null;
  const [meilleur, n] = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!;
  return n >= MAJORITE * rapports.length ? meilleur : null;
}

/**
 * Le nombre de portions POUR LEQUEL la recette est écrite.
 *
 * Le seed l'annonce à 1 pour les 10 188 recettes — un chiffre jamais mesuré, seulement
 * subi : chaque fiche disait « pour 1 portion » et divisait ses quantités d'autant. Le vrai
 * rendement est celui que la V3 a APPLIQUÉ, et il se retrouve (10 049 recettes sur 10 185).
 *
 * ⚠️ Le changer n'a de sens qu'en multipliant les quantités par le MÊME nombre : le facteur
 * d'échelle d'un batch vaut `portions / servings`, donc les deux se compensent exactement et
 * aucun batch déjà composé ne bouge. Les déplacer séparément fausserait tout d'un facteur R.
 */
export function portionsRecette(lignes: LigneSource[], servingsSeed: number): number {
  return rendementRecette(lignes) ?? servingsSeed;
}

/**
 * Mots DÉNOMBRABLES qui valent « une pièce » quand le texte n'annonce aucun nombre :
 * « branche de persil » se lit « UNE branche de persil ». Liste FERMÉE, dérivée du corpus.
 *
 * ⚠️ Sans elle, ces lignes tomberaient en « au goût » alors que le compte est évident pour
 * n'importe quel lecteur — et « au goût » sur une branche de persil est une perte
 * d'information, pas une honnêteté.
 *
 * ⚠️ ELLE NE CONTIENT AUCUN MOT DE MESURE, et ce n'est pas suffisant : le garde qui compte
 * est `donneUnePiece` ci-dessous. Mesuré sur 3 000 batchs simulés — « cuillères à soupe
 * d'huile d'olive », sans nombre, produisait 15 ml BIEN QU'aucun mot de mesure ne soit dans
 * cette liste : c'est la colonne `unit` du seed qui portait « cuillères ». Deviner une
 * PIÈCE, c'est lire un pluriel élidé ; deviner une MESURE, c'est fabriquer un chiffre.
 */
const PIECE_IMPLICITE =
  /^(?:une?\s+)?(?:demi|demie|branche|brin|feuille|gousse|tranche|filet|morceau|zeste|grappe|lamelle|clou|goutte|poignee|poignée|botte|bouquet|tige|rondelle|sachet)s?\b/i;

/** Le « 1 » sous-entendu n'est admis que si l'ingrédient se COMPTE une fois converti. */
function donneUnePiece(ligne: LigneSource): boolean {
  if (!PIECE_IMPLICITE.test((ligne.raw ?? "").trim())) return false;
  if (ligne.unite === undefined) return true;
  return normalizeQty(1, ligne.unite, ligne.raw, "").unit === "unite";
}

/** Ce que la quantité par portion DEVRAIT valoir, ou `null` quand il n'y a rien à corriger. */
export type Motif = "fraction" | "sansNombre" | "sentinelle" | "rendementInconnu";
export type Verdict = { corriger: false } | { corriger: true; qpp: number | null; motif: Motif };

/** La V3 posait cette valeur quand elle renonçait à lire une quantité. */
const SENTINELLE = 0.0001;

/**
 * Juge UNE ligne. Ne corrige que les trois dégâts caractérisés ; abstention partout ailleurs.
 *
 * `rendement` vient de `rendementRecette` : `null` ⇒ on ne touche à rien, faute de pouvoir
 * exprimer la correction par portion.
 */
export function quantiteCorrigee(ligne: LigneSource, rendement: number | null): Verdict {
  const { valeur, fraction } = nombreEnTete(ligne.raw);
  const qpp = ligne.qpp;
  if (qpp === null || !Number.isFinite(qpp)) return { corriger: false };

  const chiffre = /^\s*-?\s*(?:~|environ\s+)?\d/.test((ligne.raw ?? "").trim());

  // ── Aucun nombre, et pas même une pièce sous-entendue ──────────────────────────────────
  // Ne dépend d'AUCUN rendement : « au goût » est la même réponse quel que soit le nombre de
  // portions. C'est ce qui permet de traiter aussi les recettes dont le rendement est perdu.
  if (!chiffre && !donneUnePiece(ligne)) {
    return { corriger: true, qpp: null, motif: "sansNombre" };
  }

  // ── Rendement irrécupérable ────────────────────────────────────────────────────────────
  // 136 recettes dont la V3 a divisé tout le contenu par un nombre qui n'est pas un rendement
  // (500, 1 250, 10 000, 66…). Leurs RAPPORTS entre ingrédients restent justes, mais l'ÉCHELLE
  // est perdue : « 200 g de thon » y est devenu 0,02 g par portion, et rien ne dit par quoi
  // multiplier. Une quantité qu'on ne sait pas exprimer ne se garde pas « au cas où » — elle
  // affirme un chiffre faux à chaque affichage. On rend « au goût », en gardant le texte
  // source en note : rien n'est perdu, et plus rien n'est affirmé à tort.
  if (rendement === null) return { corriger: true, qpp: null, motif: "rendementInconnu" };

  // ── Pièce sous-entendue (« branche de persil » = UNE branche) ──────────────────────────
  if (!chiffre) {
    const attendu = 1 / rendement;
    return proche(qpp, attendu) ? { corriger: false } : { corriger: true, qpp: attendu, motif: "sansNombre" };
  }

  // ── Sentinelle ─────────────────────────────────────────────────────────────────────────
  if (Math.abs(qpp - SENTINELLE) < 1e-9) {
    if (valeur === null || valeur <= 0) return { corriger: true, qpp: null, motif: "sentinelle" };
    return { corriger: true, qpp: valeur / rendement, motif: "sentinelle" };
  }

  // ── Fraction lue « 1 » ─────────────────────────────────────────────────────────────────
  // Condition SERRÉE : on exige que la V3 ait bien enregistré 1 pour la recette entière.
  // Une fraction qu'elle a lue juste (85 lignes) ne remplit pas la condition et n'est pas
  // touchée ; une fraction dont elle aurait pris le numérateur non plus — on ne corrige que
  // le dégât qu'on a caractérisé, jamais un écart qu'on ne sait pas expliquer.
  if (fraction && valeur !== null && valeur > 0 && proche(qpp * rendement, 1)) {
    return { corriger: true, qpp: valeur / rendement, motif: "fraction" };
  }

  return { corriger: false };
}

/**
 * La note à garder quand la quantité disparaît : le texte source, mais SEULEMENT s'il
 * annonçait un nombre. « Thon — au goût (200 g de thon) » informe ; « Huile — au goût
 * (huile) » répète le nom, et « Poivre 5 Baies — au goût (poivre 5 baies) » aussi (le 5 est
 * dans le nom du poivre, pas une quantité).
 *
 * Une seule implémentation pour l'import ET la passe de réparation : deux copies d'une même
 * règle, c'est une règle et demie.
 */
export function noteSourcePerdue(raw: string, qtyFinale: number | null): string | null {
  if (qtyFinale !== null) return null;
  return nombreEnTete(raw).valeur === null ? null : raw.slice(0, 200);
}

function proche(a: number | null, b: number): boolean {
  if (a === null || !Number.isFinite(a)) return false;
  return Math.abs(a - b) <= Math.max(1e-6, 0.01 * Math.abs(b));
}
