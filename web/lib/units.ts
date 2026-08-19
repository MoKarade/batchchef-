// lib/units.ts — normalisation des unités brutes (Marmiton V3) vers le référentiel
// g / ml / unite du nouveau schéma. Fonction PURE et testée.
//
// Règle : masses → g, volumes → ml, pièces → unite. Une unité non convertible en une
// quantité fiable (« pincée », inconnue) devient qty=null/unit=null (« au goût ») —
// on n'invente jamais un poids. Les cuillères sont désambiguïsées via le texte brut
// (« à thé/café » = 5 ml, sinon « à soupe » = 15 ml).

export interface NormalizedQty {
  qty: number | null;
  unit: "g" | "ml" | "unite" | null;
}

/**
 * Multiplicateurs vers l'unité cible. `null` = non convertible → « au goût ».
 *
 * ⚠️ LES UNITÉS ANGLAISES SONT INDISPENSABLES, pas un confort. Une partie des reels que
 * Marc importe sont en anglais et comptent en cups / oz / lb. Sans ces entrées, chacune
 * de leurs quantités tombait en `null` : la recette paraissait extraite, et la liste
 * d'épicerie sortait SANS AUCUN CHIFFRE, sans qu'une seule erreur ne s'affiche.
 *
 * Choix assumés, tous documentés parce qu'ils sont approximatifs par nature :
 * - `cup` vaut 250 ml comme la « tasse » québécoise, et non les 236,6 ml américains.
 *   Cohérence avec le reste de l'app d'abord ; l'écart (5 %) est très inférieur à
 *   l'imprécision d'une cuisine, et deux valeurs différentes pour le même mot seraient
 *   pire que l'écart lui-même.
 * - `oz` seul est une MASSE (28,35 g), `fl oz` un VOLUME. C'est la lecture standard.
 * - `stick` = 113 g : convention américaine du beurre (½ cup), sans ambiguïté réelle.
 * - `can`, `package`, `bunch` restent `null` : leur contenu n'a aucune taille fixe, et
 *   inventer un poids serait exactement ce que le projet refuse.
 *
 * ⚠️ SYMÉTRIE FR/EN — mesurée le 19/08/2026 sur 50 unités réelles : 58 % des quantités
 * tombaient en « au goût ». La cause n'était pas l'anglais mais le FRANÇAIS : les entrées
 * anglaises avaient été ajoutées en bloc sans revoir leurs équivalents français, et la table
 * connaissait donc mieux l'anglais que le français dans une app 100 % francophone —
 * `cloves` → 2 unités mais `gousses` PERDU, `lb` → 907 g mais `livre` PERDU, `slices` OK
 * mais `tranches` PERDU. Toute unité ajoutée dans une langue se pose DANS LES DEUX, sinon
 * l'asymétrie se recreuse en silence : rien n'échoue, la quantité disparaît simplement.
 *
 * ⚠️ Un DÉNOMBRABLE n'est pas « au goût ». « 4 œufs », « 2 branches de céleri »,
 * « 3 large eggs » portent un compte parfaitement exploitable — les traiter comme une
 * pincée jetait une information que la source donnait noir sur blanc. Les CALIBRES
 * (`large`, `gros`, `petit`) sont des adjectifs de taille : la quantité reste le compte.
 */
const FACTORS: Record<string, { target: "g" | "ml" | "unite"; factor: number } | null> = {
  unite: { target: "unite", factor: 1 },
  g: { target: "g", factor: 1 },
  kg: { target: "g", factor: 1000 },
  mg: { target: "g", factor: 0.001 },
  ml: { target: "ml", factor: 1 },
  cl: { target: "ml", factor: 10 },
  dl: { target: "ml", factor: 100 },
  l: { target: "ml", factor: 1000 },
  tasse: { target: "ml", factor: 250 },
  tasses: { target: "ml", factor: 250 },

  // ── Français : masses impériales (miroir de lb / oz) ────────────────────────
  livre: { target: "g", factor: 453.59 },
  livres: { target: "g", factor: 453.59 },
  once: { target: "g", factor: 28.35 },
  onces: { target: "g", factor: 28.35 },

  // ── Français : dénombrables (miroir de cloves / slices / pieces) ────────────
  gousse: { target: "unite", factor: 1 },
  gousses: { target: "unite", factor: 1 },
  tranche: { target: "unite", factor: 1 },
  tranches: { target: "unite", factor: 1 },
  branche: { target: "unite", factor: 1 },
  branches: { target: "unite", factor: 1 },
  filet: { target: "unite", factor: 1 },
  filets: { target: "unite", factor: 1 },
  morceau: { target: "unite", factor: 1 },
  morceaux: { target: "unite", factor: 1 },
  feuille: { target: "unite", factor: 1 },
  feuilles: { target: "unite", factor: 1 },
  brin: { target: "unite", factor: 1 },
  brins: { target: "unite", factor: 1 },
  tige: { target: "unite", factor: 1 },
  tiges: { target: "unite", factor: 1 },
  "tête": { target: "unite", factor: 1 },
  tete: { target: "unite", factor: 1 },
  oeuf: { target: "unite", factor: 1 },
  oeufs: { target: "unite", factor: 1 },
  "œuf": { target: "unite", factor: 1 },
  "œufs": { target: "unite", factor: 1 },
  "unité": { target: "unite", factor: 1 },
  "unités": { target: "unite", factor: 1 },

  // ── Calibres : un adjectif de TAILLE, pas une unité. La quantité est le compte. ──
  gros: { target: "unite", factor: 1 },
  grosse: { target: "unite", factor: 1 },
  grosses: { target: "unite", factor: 1 },
  petit: { target: "unite", factor: 1 },
  petite: { target: "unite", factor: 1 },
  petits: { target: "unite", factor: 1 },
  petites: { target: "unite", factor: 1 },
  moyen: { target: "unite", factor: 1 },
  moyenne: { target: "unite", factor: 1 },

  // ── Contenants français sans taille fixe : « au goût », jamais un poids inventé ──
  pincee: null,
  "pincée": null,
  "poignée": null,
  poignee: null,
  botte: null,
  bottes: null,
  sachet: null,
  sachets: null,
  "boîte": null,
  boite: null,
  "boîtes": null,
  conserve: null,
  conserves: null,
  trait: null,
  filet_liquide: null,

  // ── Anglais : masses ────────────────────────────────────────────────────────
  gram: { target: "g", factor: 1 },
  grams: { target: "g", factor: 1 },
  gramme: { target: "g", factor: 1 },
  grammes: { target: "g", factor: 1 },
  kilogram: { target: "g", factor: 1000 },
  kilograms: { target: "g", factor: 1000 },
  ounce: { target: "g", factor: 28.35 },
  ounces: { target: "g", factor: 28.35 },
  oz: { target: "g", factor: 28.35 },
  pound: { target: "g", factor: 453.59 },
  pounds: { target: "g", factor: 453.59 },
  lb: { target: "g", factor: 453.59 },
  lbs: { target: "g", factor: 453.59 },
  stick: { target: "g", factor: 113 },
  sticks: { target: "g", factor: 113 },

  // ── Anglais : volumes ───────────────────────────────────────────────────────
  cup: { target: "ml", factor: 250 },
  cups: { target: "ml", factor: 250 },
  tablespoon: { target: "ml", factor: 15 },
  tablespoons: { target: "ml", factor: 15 },
  tbsp: { target: "ml", factor: 15 },
  tbs: { target: "ml", factor: 15 },
  teaspoon: { target: "ml", factor: 5 },
  teaspoons: { target: "ml", factor: 5 },
  tsp: { target: "ml", factor: 5 },
  "fl oz": { target: "ml", factor: 29.57 },
  "fluid ounce": { target: "ml", factor: 29.57 },
  "fluid ounces": { target: "ml", factor: 29.57 },
  pint: { target: "ml", factor: 473 },
  pints: { target: "ml", factor: 473 },
  quart: { target: "ml", factor: 946 },
  quarts: { target: "ml", factor: 946 },
  milliliter: { target: "ml", factor: 1 },
  milliliters: { target: "ml", factor: 1 },
  millilitre: { target: "ml", factor: 1 },
  liter: { target: "ml", factor: 1000 },
  liters: { target: "ml", factor: 1000 },
  litre: { target: "ml", factor: 1000 },
  litres: { target: "ml", factor: 1000 },

  // ── Anglais : pièces ────────────────────────────────────────────────────────
  piece: { target: "unite", factor: 1 },
  pieces: { target: "unite", factor: 1 },
  whole: { target: "unite", factor: 1 },
  clove: { target: "unite", factor: 1 },
  cloves: { target: "unite", factor: 1 },
  slice: { target: "unite", factor: 1 },
  slices: { target: "unite", factor: 1 },
  stalk: { target: "unite", factor: 1 },
  stalks: { target: "unite", factor: 1 },
  sprig: { target: "unite", factor: 1 },
  sprigs: { target: "unite", factor: 1 },
  head: { target: "unite", factor: 1 },
  heads: { target: "unite", factor: 1 },
  fillet: { target: "unite", factor: 1 },
  fillets: { target: "unite", factor: 1 },
  leaf: { target: "unite", factor: 1 },
  leaves: { target: "unite", factor: 1 },
  strip: { target: "unite", factor: 1 },
  strips: { target: "unite", factor: 1 },
  large: { target: "unite", factor: 1 },
  medium: { target: "unite", factor: 1 },
  small: { target: "unite", factor: 1 },

  // ── Contenants sans taille fixe : « au goût », jamais un poids inventé ──────
  pinch: null,
  dash: null,
  can: null,
  cans: null,
  package: null,
  packages: null,
  bunch: null,
  handful: null,
  splash: null,
  knob: null,
};

/**
 * Ingrédients pour lesquels « stick » est une PLAQUE DE BEURRE (113 g) et non une tige.
 *
 * Sans ça, « 1 cinnamon stick » valait 113 g de cannelle — absurde en cuisine, et le prix
 * estimé suivait. Le nom de l'ingrédient est le seul discriminant possible ; il arrive donc
 * en paramètre séparé, JAMAIS fondu dans `rawText` : celui-ci sert à désambiguïser les
 * cuillères en cherchant « thé »/« café », et « 1 c. à soupe de café moulu » deviendrait
 * alors 5 ml au lieu de 15.
 */
const STICK_EST_DU_BEURRE = /beurre|butter|margarine/i;

export function normalizeQty(
  qty: number | null | undefined,
  unit: string | null | undefined,
  rawText = "",
  /** Nom de l'ingrédient — sert UNIQUEMENT à lever l'ambiguïté de « stick » (cf. plus haut). */
  nomIngredient = "",
): NormalizedQty {
  if (qty === null || qty === undefined || !Number.isFinite(qty) || qty <= 0) {
    return { qty: null, unit: null };
  }
  const key = (unit ?? "").trim().toLowerCase();

  // Cuillères : « à thé/café » = 5 ml, sinon « à soupe » = 15 ml (défaut).
  if (key.startsWith("cuill") || key.startsWith("c.")) {
    const raw = rawText.toLowerCase();
    const ml = raw.includes("thé") || raw.includes("the") || raw.includes("café") || raw.includes("cafe") ? 5 : 15;
    return { qty: round(qty * ml), unit: "ml" };
  }

  // Les abréviations anglaises arrivent ponctuées de façons diverses (« oz. », « fl. oz. »,
  // « lb. »). On retente donc sans les points — APRÈS la branche des cuillères, qui
  // s'appuie précisément sur le point de « c. à soupe ».
  const cleNettoyee = key.replace(/\./g, "").replace(/\s+/g, " ").trim();
  // `key in FACTORS` plutôt que `??` : il faut distinguer « connue mais non convertible »
  // (valeur null, ex. « pincée ») de « inconnue » (absente) — sinon la seconde recherche
  // écraserait la première et le sens du null se perdrait.
  // « stick » : plaque de beurre (113 g) ou bâton de cannelle (1 pièce) ? Seul le nom de
  // l'ingrédient tranche. Par défaut on compte une PIÈCE : se tromper d'un bâton est sans
  // conséquence, se tromper de 113 g de cannelle fausse la recette et son prix.
  if (cleNettoyee === "stick" || cleNettoyee === "sticks") {
    return STICK_EST_DU_BEURRE.test(nomIngredient)
      ? { qty: round(qty * 113), unit: "g" }
      : { qty: round(qty), unit: "unite" };
  }

  const mapped = key in FACTORS ? FACTORS[key] : FACTORS[cleNettoyee];
  if (mapped === undefined) return { qty: null, unit: null }; // unité inconnue → au goût
  if (mapped === null) return { qty: null, unit: null }; // pincée & co
  return { qty: round(qty * mapped.factor), unit: mapped.target };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
