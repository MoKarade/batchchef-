"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCatalogRecipeToLibrary } from "@/lib/actions";

export function AddToLibraryButton({ catalogRecipeId }: { catalogRecipeId: number }) {
  const [state, setState] = useState<"idle" | "done" | string>("idle");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (state === "done") {
    return (
      <button
        type="button"
        onClick={() => router.push("/recettes")}
        className="shrink-0 rounded-xl border border-stone-300 px-3 py-2 text-sm dark:border-stone-700"
      >
        ✓ Ajoutée — voir
      </button>
    );
  }

  return (
    <div className="shrink-0 text-right">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await addCatalogRecipeToLibrary(catalogRecipeId);
            setState(res.ok ? "done" : res.error);
          })
        }
        className="rounded-xl px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: "var(--accent)" }}
      >
        {pending ? "…" : "+ Ma bibliothèque"}
      </button>
      {state !== "idle" && state !== "done" && <p className="mt-1 max-w-40 text-xs text-red-600">{state}</p>}
    </div>
  );
}
