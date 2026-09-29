"use client";

// Section ingrédients d'une recette : lecture par défaut, édition sur demande.
// Marc corrige le nombre de portions de référence (rescale tout côté batch) ET chaque
// quantité/unité/nom, avec ajout et suppression. C'est le levier du « 100 % précis ».

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRecipe } from "@/lib/actions";
import { formatQty } from "@/lib/aggregate";
import { IngredientFields, rowToEditable, type EditRow, type Unit } from "@/components/IngredientFields";

interface InitialIngredient {
  name: string;
  qty: number | null;
  unit: Unit;
  note: string | null;
}

function toRow(i: InitialIngredient): EditRow {
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
  const [rows, setRows] = useState<EditRow[]>(initial.map(toRow));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const reset = () => {
    setServings(String(initialServings));
    setRows(initial.map(toRow));
    setError(null);
    setEditing(false);
  };

  const save = () =>
    startTransition(async () => {
      setError(null);
      const res = await updateRecipe({
        recipeId,
        servings: Number(servings) || 1,
        ingredients: rows.map(rowToEditable),
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
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Ingrédients (pour {initialServings} portions)</h2>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="bouton bouton-second"
          >
            Modifier
          </button>
        </div>
        <ul className="liste">
          {initial.map((ing, i) => (
            <li key={i} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <span>
                {ing.name}
                {ing.note && <span className="doux"> — {ing.note}</span>}
              </span>
              <span className="tabular-nums doux">
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
      <h2 className="text-xl font-bold">Corriger la recette</h2>

      <label className="flex items-center gap-3 text-sm etiquette !mb-0">
        <span className="shrink-0">Portions de référence</span>
        <input
          type="number"
          min={1}
          max={50}
          value={servings}
          onChange={(e) => setServings(e.target.value)}
          disabled={pending}
          className="champ w-20 text-center num"
        />
      </label>
      <p className="text-sm doux">
        Les quantités ci-dessous valent pour ce nombre de portions. À la création d’un batch,
        elles sont mises à l’échelle des portions voulues.
      </p>

      <IngredientFields rows={rows} onChange={setRows} disabled={pending} />

      {error && (
        <p className="bandeau erreur" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="bouton bouton-second flex-1"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="bouton bouton-principal flex-1"
        >
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </section>
  );
}
