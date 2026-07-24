"use client";

// Import de recette par URL, en DEUX temps :
//   1. « Analyser » : parse LLM + 2ᵉ passe de vérification (côté serveur), rien n'est sauvé.
//   2. Écran de VALIDATION : titre, portions et chaque ingrédient éditables → « Enregistrer ».
// Marc confirme/corrige avant que quoi que ce soit entre en base (précision garantie).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseRecipePreview, saveImportedRecipe, type RecipePreview } from "@/lib/actions";
import { IngredientFields, rowToEditable, type EditRow } from "@/components/IngredientFields";

interface Draft {
  title: string;
  sourceUrl: string;
  imageUrl: string | null;
  servings: string;
  instructions: string | null;
  rows: EditRow[];
}

function toDraft(r: RecipePreview): Draft {
  return {
    title: r.title,
    sourceUrl: r.sourceUrl,
    imageUrl: r.imageUrl,
    servings: String(r.servings),
    instructions: r.instructions,
    rows: r.ingredients.map((i) => ({
      name: i.name,
      qty: i.qty === null ? "" : String(i.qty),
      unit: i.unit,
      note: i.note ?? "",
    })),
  };
}

export function ImportRecipeForm() {
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const analyze = () =>
    startTransition(async () => {
      setError(null);
      const res = await parseRecipePreview(url.trim());
      if (!res.ok || !res.recipe) {
        setError(res.ok ? "Rien à valider." : res.error);
        return;
      }
      setDraft(toDraft(res.recipe));
    });

  const save = () =>
    startTransition(async () => {
      if (!draft) return;
      setError(null);
      const res = await saveImportedRecipe({
        title: draft.title,
        sourceUrl: draft.sourceUrl,
        imageUrl: draft.imageUrl,
        servings: Number(draft.servings) || 1,
        instructions: draft.instructions,
        ingredients: draft.rows.map(rowToEditable),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDraft(null);
      setUrl("");
      router.push(`/recettes/${res.id}`);
    });

  // ── Étape 2 : validation éditable ─────────────────────────────────────────────
  if (draft) {
    return (
      <div className="space-y-3 rounded-2xl border border-stone-200 p-4 dark:border-stone-800">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Vérifie avant d’enregistrer</h2>
          <button
            type="button"
            onClick={() => setDraft(null)}
            disabled={pending}
            className="text-sm text-stone-500 underline"
          >
            Annuler
          </button>
        </div>
        <p className="text-xs text-stone-500">
          Analyse relue par le LLM. Corrige le titre, les portions ou une quantité si besoin —
          c’est ce que tu valides qui est enregistré.
        </p>

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
            onChange={(e) => setDraft({ ...draft, servings: e.target.value })}
            disabled={pending}
            className="w-20 rounded-lg border border-stone-300 bg-white px-2 py-2 text-center tabular-nums dark:border-stone-700 dark:bg-stone-900"
          />
        </label>

        <IngredientFields
          rows={draft.rows}
          onChange={(rows) => setDraft({ ...draft, rows })}
          disabled={pending}
        />

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

  // ── Étape 1 : URL → analyse ───────────────────────────────────────────────────
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        analyze();
      }}
    >
      <div className="flex gap-2">
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Colle l’URL d’une recette (n’importe quel site)"
          className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-3 py-3 text-sm dark:border-stone-700 dark:bg-stone-900"
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending || !url.trim()}
          className="rounded-xl px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: "var(--accent)" }}
        >
          {pending ? "Analyse…" : "Analyser"}
        </button>
      </div>
      {pending && (
        <p className="text-xs text-stone-500">
          Lecture de la page, extraction puis vérification de la recette (20-30 s)…
        </p>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
