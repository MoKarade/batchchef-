"use client";

// Formulaire d'import de recette par URL (parse LLM côté serveur). Feedback honnête :
// spinner pendant le parse (~10-20 s), erreur affichée telle quelle, jamais silencieuse.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importRecipeFromUrl } from "@/lib/actions";

export function ImportRecipeForm() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await importRecipeFromUrl(url.trim());
          if (!res.ok) {
            setError(res.error);
            return;
          }
          setUrl("");
          router.push(`/recettes/${res.id}`);
        });
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
          {pending ? "Analyse…" : "Importer"}
        </button>
      </div>
      {pending && (
        <p className="text-xs text-stone-500">
          Lecture de la page et extraction de la recette (10-20 s)…
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
