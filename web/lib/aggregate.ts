// lib/aggregate.ts — agrégation de la liste d'épicerie d'un batch.
//
// Fonctions PURES (testées) : mise à l'échelle des quantités par portions voulues, puis
// regroupement par ingrédient canonique. Principe hérité de la V3 (count→mass) mais
// simplifié : les unités sont déjà normalisées au parse (g / ml / unite), donc
// l'agrégation n'additionne QUE des quantités de même unité. Deux unités incompatibles
// pour le même canonical → deux lignes distinctes (honnête, jamais une somme absurde).

export interface IngredientLine {
  name: string;
  canonical: string;
  /** Quantité pour `servings` portions de la recette ; null = « au goût ». */
  qty: number | null;
  unit: "g" | "ml" | "unite" | null;
}

export interface RecipeForBatch {
  servings: number;
  portions: number;
  ingredients: IngredientLine[];
}

export interface AggregatedItem {
  name: string;
  canonical: string;
  qty: number | null;
  unit: "g" | "ml" | "unite" | null;
}

/** Arrondi d'affichage : 1 décimale max, entiers pour les unités. */
function round(qty: number, unit: IngredientLine["unit"]): number {
  if (unit === "unite") return Math.ceil(qty * 10) / 10;
  return Math.round(qty * 10) / 10;
}

/**
 * Agrège les ingrédients de plusieurs recettes mises à l'échelle de leurs portions.
 * Regroupement par (canonical, unit) ; les lignes sans quantité (« au goût ») sont
 * regroupées entre elles par canonical et gardent qty=null.
 */
export function aggregateShoppingList(recipes: RecipeForBatch[]): AggregatedItem[] {
  const groups = new Map<string, AggregatedItem>();

  for (const recipe of recipes) {
    if (recipe.servings <= 0) continue; // recette mal saisie : ne corrompt pas la liste
    const scale = recipe.portions / recipe.servings;

    for (const ing of recipe.ingredients) {
      const canonical = ing.canonical.trim().toLowerCase();
      if (!canonical) continue;
      const unit = ing.qty === null ? null : ing.unit;
      const key = `${canonical}|${unit ?? "sans-qty"}`;

      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          // Le premier nom rencontré sert d'étiquette d'affichage.
          name: ing.name.trim(),
          canonical,
          qty: ing.qty === null ? null : round(ing.qty * scale, unit),
          unit,
        });
        continue;
      }
      if (ing.qty !== null && existing.qty !== null) {
        existing.qty = round(existing.qty + ing.qty * scale, unit);
      }
      // qty null + qty null → reste null (« au goût », dédupliqué).
    }
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

/**
 * Met une quantité d'ingrédient à l'échelle des portions voulues (pour la vue cuisine :
 * chaque recette affichée aux portions du batch, pas à ses portions de référence).
 * « au goût » (qty null) reste null. Servings ≤ 0 → pas de mise à l'échelle (null).
 */
export function scaleQty(
  qty: number | null,
  unit: AggregatedItem["unit"],
  portions: number,
  servings: number,
): number | null {
  if (qty === null || servings <= 0 || portions <= 0) return qty === null ? null : qty;
  return round((qty * portions) / servings, unit);
}

/**
 * Garantit un prix pour CHAQUE article (couverture 100 %). Les coûts déjà estimés par le
 * LLM servent de référence : un article laissé sans prix reçoit le coût moyen PAR UNITÉ
 * observé sur les articles de même unité de CE batch ; à défaut, un tarif prudent par unité ;
 * « au goût » → petite portion. Toujours ≥ 0,05 $, arrondi au cent. Reste une ESTIMATION.
 */
export function fillMissingCosts(
  items: Array<{ qty: number | null; unit: AggregatedItem["unit"] }>,
  costs: Array<number | null>,
): number[] {
  const DEFAULT_PER_UNIT: Record<"g" | "ml" | "unite", number> = { g: 0.008, ml: 0.005, unite: 1.2 };
  const AU_GOUT = 0.3; // pincée de sel / épices : petite portion d'usage
  const FLOOR = 0.05;

  // Coût moyen par unité observé sur les articles réellement chiffrés (qty connue > 0).
  const acc: Record<string, { cost: number; qty: number }> = {};
  items.forEach((it, i) => {
    const c = costs[i];
    if (c == null || it.qty == null || it.qty <= 0 || !it.unit) return;
    const a = acc[it.unit] ?? { cost: 0, qty: 0 };
    a.cost += c;
    a.qty += it.qty;
    acc[it.unit] = a;
  });
  const perUnit = (u: "g" | "ml" | "unite"): number => {
    const a = acc[u];
    return a && a.qty > 0 ? a.cost / a.qty : DEFAULT_PER_UNIT[u];
  };

  return items.map((it, i) => {
    const known = costs[i];
    let cost: number;
    if (known != null) cost = known;
    else if (it.qty != null && it.qty > 0 && it.unit) cost = perUnit(it.unit) * it.qty;
    else cost = AU_GOUT;
    return Math.max(FLOOR, Math.round(cost * 100) / 100);
  });
}

/**
 * Titres d'articles pour un export (Google Tasks, partage…) : un par article, « nom — qté »
 * (ou juste le nom si « au goût »). N'exporte que le RESTANT à acheter (non coché) ; si tout
 * est coché, exporte toute la liste (repli).
 */
export function shoppingTitles(
  items: Array<{ name: string; qty: number | null; unit: AggregatedItem["unit"]; checked: boolean }>,
): string[] {
  const remaining = items.filter((i) => !i.checked);
  const list = remaining.length > 0 ? remaining : items;
  return list.map((i) => (i.qty !== null ? `${i.name} — ${formatQty(i.qty, i.unit)}` : i.name));
}

/** « 1 250 g » → « 1,25 kg » ; « 750 ml » → « 750 ml » ; unités entières. Affichage fr-CA. */
export function formatQty(qty: number | null, unit: AggregatedItem["unit"]): string {
  if (qty === null) return "au goût";
  const fmt = (n: number) =>
    n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });
  if (unit === "g") return qty >= 1000 ? `${fmt(qty / 1000)} kg` : `${fmt(qty)} g`;
  if (unit === "ml") return qty >= 1000 ? `${fmt(qty / 1000)} L` : `${fmt(qty)} ml`;
  return fmt(qty);
}
