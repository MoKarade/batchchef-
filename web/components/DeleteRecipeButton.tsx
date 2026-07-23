"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteRecipe } from "@/lib/actions";

export function DeleteRecipeButton({ recipeId }: { recipeId: number }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="text-right">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm("Supprimer cette recette ?")) return;
          startTransition(async () => {
            const res = await deleteRecipe(recipeId);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            router.push("/recettes");
          });
        }}
        className="rounded-lg border border-stone-300 px-3 py-2 text-xs text-stone-600 dark:border-stone-700 dark:text-stone-400"
      >
        {pending ? "…" : "Supprimer"}
      </button>
      {error && <p className="mt-1 max-w-40 text-xs text-red-600">{error}</p>}
    </div>
  );
}
