"use client";

// Éditeur de lignes d'ingrédients (présentational, contrôlé). Partagé par la correction
// de recette et l'écran de validation à l'import — une seule UI, pas de divergence.

export type Unit = "g" | "ml" | "unite" | null;

export interface EditRow {
  name: string;
  qty: string; // champ libre : vide = « au goût »
  unit: Unit;
  note: string;
}

export function emptyRow(): EditRow {
  return { name: "", qty: "", unit: "g", note: "" };
}

const UNIT_LABEL: Record<"g" | "ml" | "unite", string> = { g: "g", ml: "ml", unite: "unité" };

export function IngredientFields({
  rows,
  onChange,
  disabled,
}: {
  rows: EditRow[];
  onChange: (rows: EditRow[]) => void;
  disabled?: boolean;
}) {
  const setRow = (idx: number, patch: Partial<EditRow>) =>
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const addRow = () => onChange([...rows, emptyRow()]);
  const removeRow = (idx: number) => onChange(rows.filter((_, i) => i !== idx));

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {rows.map((r, idx) => (
          <li key={idx} className="space-y-2 rounded-xl border border-stone-200 p-3 dark:border-stone-800">
            <input
              type="text"
              value={r.name}
              onChange={(e) => setRow(idx, { name: e.target.value })}
              placeholder="Nom de l’ingrédient"
              disabled={disabled}
              className="w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={r.qty}
                onChange={(e) => setRow(idx, { qty: e.target.value })}
                placeholder="Qté"
                disabled={disabled}
                className="w-20 rounded-lg border border-stone-300 bg-white px-2 py-2 text-center text-sm tabular-nums dark:border-stone-700 dark:bg-stone-900"
              />
              <select
                value={r.unit ?? "augout"}
                onChange={(e) =>
                  setRow(idx, { unit: e.target.value === "augout" ? null : (e.target.value as Unit) })
                }
                disabled={disabled}
                className="rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
              >
                <option value="g">{UNIT_LABEL.g}</option>
                <option value="ml">{UNIT_LABEL.ml}</option>
                <option value="unite">{UNIT_LABEL.unite}</option>
                <option value="augout">au goût</option>
              </select>
              <input
                type="text"
                value={r.note}
                onChange={(e) => setRow(idx, { note: e.target.value })}
                placeholder="Note (facultatif)"
                disabled={disabled}
                className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
              />
              <button
                type="button"
                onClick={() => removeRow(idx)}
                disabled={disabled}
                aria-label="Supprimer l’ingrédient"
                className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-500 dark:border-stone-700"
              >
                Retirer
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={addRow}
        disabled={disabled}
        className="w-full rounded-xl border border-dashed border-stone-300 px-3 py-2 text-sm text-stone-600 dark:border-stone-700 dark:text-stone-400"
      >
        + Ajouter un ingrédient
      </button>
    </div>
  );
}

/** Convertit une ligne éditée en payload d'action (qty « 1,5 » → 1.5, vide → null). */
export function rowToEditable(r: EditRow): { name: string; qty: number | null; unit: Unit; note: string | null } {
  const raw = r.qty.trim().replace(",", ".");
  const q = raw === "" ? null : Number(raw);
  return {
    name: r.name,
    qty: q !== null && Number.isFinite(q) ? q : null,
    unit: r.unit,
    note: r.note.trim() || null,
  };
}
