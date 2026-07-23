"use client";

// Composer un batch : cocher des recettes, choisir les portions de chacune.
// À la création : liste agrégée générée + estimation budget (best-effort, honnête).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBatch } from "@/lib/actions";

interface RecipeOption {
  id: number;
  title: string;
  servings: number;
}

export function NewBatchForm({ recipes }: { recipes: RecipeOption[] }) {
  const [name, setName] = useState("");
  const [portions, setPortions] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const toggle = (id: number, base: number) =>
    setPortions((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = base;
      return next;
    });

  if (recipes.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500 dark:border-stone-700">
        Importe d’abord des recettes dans ta bibliothèque.
      </p>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await createBatch({
            name,
            selections: Object.entries(portions).map(([recipeId, p]) => ({
              recipeId: Number(recipeId),
              portions: p,
            })),
          });
          if (!res.ok) {
            setError(res.error);
            return;
          }
          router.push(`/batchs/${res.id}`);
        });
      }}
    >
      <input
        type="text"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nom du batch (ex. Semaine du 28 juillet)"
        className="w-full rounded-xl border border-stone-300 bg-white px-3 py-3 text-sm dark:border-stone-700 dark:bg-stone-900"
        disabled={pending}
      />

      <ul className="divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
        {recipes.map((r) => {
          const selected = r.id in portions;
          return (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3">
              <input
                type="checkbox"
                id={`r-${r.id}`}
                checked={selected}
                onChange={() => toggle(r.id, r.servings)}
                className="h-6 w-6 accent-orange-700"
                disabled={pending}
              />
              <label htmlFor={`r-${r.id}`} className="min-w-0 flex-1 text-sm">
                {r.title}
              </label>
              {selected && (
                <label className="flex shrink-0 items-center gap-1 text-sm">
                  <input
                    type="number"
                    min={1}
                    max={40}
                    value={portions[r.id] ?? r.servings}
                    onChange={(e) =>
                      setPortions((prev) => ({ ...prev, [r.id]: Number(e.target.value) }))
                    }
                    className="w-16 rounded-lg border border-stone-300 bg-white px-2 py-2 text-center tabular-nums dark:border-stone-700 dark:bg-stone-900"
                    disabled={pending}
                  />
                  portions
                </label>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || Object.keys(portions).length === 0 || !name.trim()}
        className="w-full rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: "var(--accent)" }}
      >
        {pending ? "Génération de la liste…" : "Créer le batch"}
      </button>
      {pending && (
        <p className="text-center text-xs text-stone-500">
          Agrégation des ingrédients + estimation du budget (quelques secondes)…
        </p>
      )}
    </form>
  );
}
