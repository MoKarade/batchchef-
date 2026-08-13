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
  pincee: null,
  "pincée": null,

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

  // ── Contenants sans taille fixe : « au goût », jamais un poids inventé ──────
  pinch: null,
  dash: null,
  can: null,
  cans: null,
  package: null,
  packages: null,
  bunch: null,
  handful: null,
};

export function normalizeQty(
  qty: number | null | undefined,
  unit: string | null | undefined,
  rawText = "",
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
  const mapped = key in FACTORS ? FACTORS[key] : FACTORS[cleNettoyee];
  if (mapped === undefined) return { qty: null, unit: null }; // unité inconnue → au goût
  if (mapped === null) return { qty: null, unit: null }; // pincée & co
  return { qty: round(qty * mapped.factor), unit: mapped.target };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
