// lib/recipeEdit.ts — logique PURE de l'édition d'une recette (testable sans base).
// Nettoie les lignes saisies par Marc : trim, canonical dérivé du nom, quantité/unité
// cohérentes (« au goût » = pas de quantité → pas d'unité). Une ligne sans nom est ignorée.

export interface EditableIngredient {
  name: string;
  qty: number | null;
  unit: "g" | "ml" | "unite" | null;
  note: string | null;
}

export interface PreparedIngredient {
  name: string;
  canonical: string;
  qty: number | null;
  unit: "g" | "ml" | "unite" | null;
  note: string | null;
}

/** Borne le nombre de portions de référence à un entier valide (1…50). */
export function clampServings(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(50, Math.round(n)));
}

/** Transforme les lignes éditées en lignes prêtes à insérer (canonical dérivé, cohérence qty/unit). */
export function prepareIngredientRows(rows: EditableIngredient[]): PreparedIngredient[] {
  const out: PreparedIngredient[] = [];
  for (const r of rows) {
    const name = r.name.trim();
    if (!name) continue; // ligne vide → ignorée
    // Quantité valide seulement si > 0 ; sinon « au goût » (qty ET unit à null).
    const qty = r.qty !== null && Number.isFinite(r.qty) && r.qty > 0 ? r.qty : null;
    const note = r.note?.trim() ? r.note.trim() : null;
    out.push({
      name,
      canonical: name.toLowerCase(),
      qty,
      unit: qty === null ? null : r.unit,
      note,
    });
  }
  return out;
}
