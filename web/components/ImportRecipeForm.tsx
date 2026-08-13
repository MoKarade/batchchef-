"use client";

// Import de recette par URL, en DEUX temps :
//   1. « Analyser » : parse LLM + 2ᵉ passe de vérification (côté serveur), rien n'est sauvé.
//   2. Écran de VALIDATION (RecipeDraftEditor, partagé avec l'import vidéo) → « Enregistrer ».
// Marc confirme/corrige avant que quoi que ce soit entre en base (précision garantie).

import { useState, useTransition } from "react";
import { parseRecipePreview, type RecipePreview } from "@/lib/actions";
import { RecipeDraftEditor } from "@/components/RecipeDraftEditor";

export function ImportRecipeForm() {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<RecipePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const analyze = () =>
    startTransition(async () => {
      setError(null);
      const res = await parseRecipePreview(url.trim());
      if (!res.ok || !res.recipe) {
        setError(res.ok ? "Rien à valider." : res.error);
        return;
      }
      setPreview(res.recipe);
    });

  if (preview) {
    return (
      <RecipeDraftEditor
        preview={preview}
        onCancel={() => setPreview(null)}
      />
    );
  }

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
          className="min-w-0 flex-1 rounded-xl border border-[var(--bordure)] bg-white px-3 py-3 text-sm  "
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
        <p className="text-xs doux">
          Lecture de la page, extraction puis vérification de la recette (20-30 s)…
        </p>
      )}
      {error && (
        <p className="rounded-lg erreur p-2 text-sm">
          {error}
        </p>
      )}
    </form>
  );
}
