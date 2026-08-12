"use client";

// Écran de VALIDATION d'une recette extraite, partagé par les deux imports (URL et vidéo).
// Une seule copie : deux écrans séparés divergeraient au premier champ ajouté, et c'est ici
// que se joue la précision — rien n'entre en base sans que Marc l'ait relu.

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { saveImportedRecipe, type RecipePreview } from "@/lib/actions";
import { IngredientFields, rowToEditable, type EditRow } from "@/components/IngredientFields";

interface Draft {
  title: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  servings: string;
  servingsGuessed: boolean;
  instructions: string;
  rows: EditRow[];
}

function toDraft(r: RecipePreview): Draft {
  return {
    title: r.title,
    sourceUrl: r.sourceUrl,
    imageUrl: r.imageUrl,
    servings: String(r.servings),
    servingsGuessed: r.servingsGuessed,
    instructions: r.instructions ?? "",
    rows: r.ingredients.map((i) => ({
      name: i.name,
      qty: i.qty === null ? "" : String(i.qty),
      unit: i.unit,
      note: i.note ?? "",
    })),
  };
}

export function RecipeDraftEditor({
  preview,
  onCancel,
  hint,
}: {
  preview: RecipePreview;
  onCancel: () => void;
  /** Message de contexte propre à la source (ex. nombre d'images lues). */
  hint?: ReactNode;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(preview));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const save = () =>
    startTransition(async () => {
      setError(null);
      const res = await saveImportedRecipe({
        title: draft.title,
        sourceUrl: draft.sourceUrl,
        imageUrl: draft.imageUrl,
        servings: Number(draft.servings) || 1,
        instructions: draft.instructions.trim() || null,
        ingredients: draft.rows.map(rowToEditable),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/recettes/${res.id}`);
    });

  return (
    <div className="space-y-3 rounded-2xl border border-stone-200 p-4 dark:border-stone-800">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Vérifie avant d’enregistrer</h2>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="text-sm text-stone-500 underline"
        >
          Annuler
        </button>
      </div>
      {hint ?? (
        <p className="text-xs text-stone-500">
          Analyse relue par le LLM. Corrige le titre, les portions ou une quantité si besoin —
          c’est ce que tu valides qui est enregistré.
        </p>
      )}

      <label className="block text-sm">
        <span className="mb-1 block text-stone-500">Titre</span>
        <input
          type="text"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          disabled={pending}
          className="w-full rounded-lg border border-stone-300 bg-white px-2 py-2 dark:border-stone-700 dark:bg-stone-900"
        />
      </label>

      <label className="flex items-center gap-3 text-sm">
        <span className="shrink-0 text-stone-500">Portions de référence</span>
        <input
          type="number"
          min={1}
          max={50}
          value={draft.servings}
          onChange={(e) => setDraft({ ...draft, servings: e.target.value, servingsGuessed: false })}
          disabled={pending}
          className="w-20 rounded-lg border border-stone-300 bg-white px-2 py-2 text-center tabular-nums dark:border-stone-700 dark:bg-stone-900"
        />
      </label>
      {draft.servingsGuessed && (
        <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Aucune portion annoncée par la source : 4 est un défaut, pas une donnée. Toutes les
          quantités de la liste d’épicerie seront mises à l’échelle à partir de ce nombre.
        </p>
      )}

      <IngredientFields
        rows={draft.rows}
        onChange={(rows) => setDraft({ ...draft, rows })}
        disabled={pending}
      />

      <label className="block text-sm">
        <span className="mb-1 block text-stone-500">Préparation</span>
        <textarea
          value={draft.instructions}
          onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
          disabled={pending}
          rows={8}
          placeholder="Étapes de la recette"
          className="w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
        />
      </label>

      {error && (
        <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={pending || !draft.title.trim()}
        className="w-full rounded-xl px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: "var(--accent)" }}
      >
        {pending ? "Enregistrement…" : "Enregistrer la recette"}
      </button>
    </div>
  );
}
