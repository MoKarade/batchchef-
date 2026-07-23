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

/** « 1 250 g » → « 1,25 kg » ; « 750 ml » → « 750 ml » ; unités entières. Affichage fr-CA. */
export function formatQty(qty: number | null, unit: AggregatedItem["unit"]): string {
  if (qty === null) return "au goût";
  const fmt = (n: number) =>
    n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });
  if (unit === "g") return qty >= 1000 ? `${fmt(qty / 1000)} kg` : `${fmt(qty)} g`;
  if (unit === "ml") return qty >= 1000 ? `${fmt(qty / 1000)} L` : `${fmt(qty)} ml`;
  return fmt(qty);
}
