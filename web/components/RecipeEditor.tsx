"use client";

// Section ingrédients d'une recette : lecture par défaut, édition sur demande.
// Marc corrige le nombre de portions de référence (rescale tout côté batch) ET chaque
// quantité/unité/nom, avec ajout et suppression. C'est le levier du « 100 % précis ».

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRecipe } from "@/lib/actions";
import { formatQty } from "@/lib/aggregate";

type Unit = "g" | "ml" | "unite" | null;

interface Row {
  name: string;
  qty: string; // champ libre : vide = « au goût »
  unit: Unit;
  note: string;
}

interface InitialIngredient {
  name: string;
  qty: number | null;
  unit: Unit;
  note: string | null;
}

const UNIT_LABEL: Record<"g" | "ml" | "unite", string> = { g: "g", ml: "ml", unite: "unité" };

function toRow(i: InitialIngredient): Row {
  return { name: i.name, qty: i.qty === null ? "" : String(i.qty), unit: i.unit, note: i.note ?? "" };
}

export function RecipeEditor({
  recipeId,
  servings: initialServings,
  ingredients: initial,
}: {
  recipeId: number;
  servings: number;
  ingredients: InitialIngredient[];
}) {
  const [editing, setEditing] = useState(false);
  const [servings, setServings] = useState(String(initialServings));
  const [rows, setRows] = useState<Row[]>(initial.map(toRow));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const reset = () => {
    setServings(String(initialServings));
    setRows(initial.map(toRow));
    setError(null);
    setEditing(false);
  };

  const setRow = (idx: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, { name: "", qty: "", unit: "g", note: "" }]);
  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx));

  const save = () =>
    startTransition(async () => {
      setError(null);
      const res = await updateRecipe({
        recipeId,
        servings: Number(servings) || 1,
        ingredients: rows.map((r) => {
          const q = r.qty.trim() === "" ? null : Number(r.qty.replace(",", "."));
          return {
            name: r.name,
            qty: q !== null && Number.isFinite(q) ? q : null,
            unit: r.unit,
            note: r.note.trim() || null,
          };
        }),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });

  if (!editing) {
    return (
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Ingrédients (pour {initialServings} portions)</h2>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm dark:border-stone-700"
          >
            Modifier
          </button>
        </div>
        <ul className="divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
          {initial.map((ing, i) => (
            <li key={i} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>
                {ing.name}
                {ing.note && <span className="text-stone-500"> — {ing.note}</span>}
              </span>
              <span className="tabular-nums text-stone-600 dark:text-stone-400">
                {formatQty(ing.qty, ing.unit)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Corriger la recette</h2>

      <label className="flex items-center gap-3 text-sm">
        <span className="shrink-0">Portions de référence</span>
        <input
          type="number"
          min={1}
          max={50}
          value={servings}
          onChange={(e) => setServings(e.target.value)}
          disabled={pending}
          className="w-20 rounded-lg border border-stone-300 bg-white px-2 py-2 text-center tabular-nums dark:border-stone-700 dark:bg-stone-900"
        />
      </label>
      <p className="text-xs text-stone-500">
        Les quantités ci-dessous valent pour ce nombre de portions. À la création d’un batch,
        elles sont mises à l’échelle des portions voulues.
      </p>

      <ul className="space-y-2">
        {rows.map((r, idx) => (
          <li
            key={idx}
            className="space-y-2 rounded-xl border border-stone-200 p-3 dark:border-stone-800"
          >
            <input
              type="text"
              value={r.name}
              onChange={(e) => setRow(idx, { name: e.target.value })}
              placeholder="Nom de l’ingrédient"
              disabled={pending}
              className="w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={r.qty}
                onChange={(e) => setRow(idx, { qty: e.target.value })}
                placeholder="Qté"
                disabled={pending}
                className="w-20 rounded-lg border border-stone-300 bg-white px-2 py-2 text-center text-sm tabular-nums dark:border-stone-700 dark:bg-stone-900"
              />
              <select
                value={r.unit ?? "augout"}
                onChange={(e) =>
                  setRow(idx, { unit: e.target.value === "augout" ? null : (e.target.value as Unit) })
                }
                disabled={pending}
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
                disabled={pending}
                className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
              />
              <button
                type="button"
                onClick={() => removeRow(idx)}
                disabled={pending}
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
        disabled={pending}
        className="w-full rounded-xl border border-dashed border-stone-300 px-3 py-2 text-sm text-stone-600 dark:border-stone-700 dark:text-stone-400"
      >
        + Ajouter un ingrédient
      </button>

      {error && (
        <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="flex-1 rounded-xl border border-stone-300 px-4 py-3 text-sm dark:border-stone-700"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="flex-1 rounded-xl px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: "var(--accent)" }}
        >
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </section>
  );
}
