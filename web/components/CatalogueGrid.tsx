"use client";

// Grille du catalogue avec SÉLECTION MULTIPLE pour ajout massif à la bibliothèque.
// Chaque carte reste un lien vers le détail ; une case en coin (au-dessus du lien)
// coche la recette sans naviguer. Une barre d'action apparaît dès qu'une case est cochée.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RecipeCard } from "@/components/RecipeCard";
import { addCatalogRecipesToLibrary } from "@/lib/actions";

interface CatalogItem {
  id: number;
  title: string;
  imageUrl: string | null;
}

export function CatalogueGrid({ recipes }: { recipes: CatalogItem[] }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clear = () => setSelected(new Set());

  const addSelected = () =>
    startTransition(async () => {
      setError(null);
      setMsg(null);
      const res = await addCatalogRecipesToLibrary([...selected]);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const parts = [`${res.added} recette${(res.added ?? 0) > 1 ? "s" : ""} ajoutée${(res.added ?? 0) > 1 ? "s" : ""}`];
      if (res.skipped) parts.push(`${res.skipped} déjà présente${res.skipped > 1 ? "s" : ""}`);
      setMsg(parts.join(" · "));
      clear();
      router.refresh();
    });

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {recipes.map((r) => {
          const isSel = selected.has(r.id);
          return (
            <li key={r.id} className="relative">
              <RecipeCard href={`/catalogue/${r.id}`} title={r.title} imageUrl={r.imageUrl} />
              {/* Case de sélection AU-DESSUS du lien (coin) : cocher n'ouvre pas la recette. */}
              <button
                type="button"
                aria-pressed={isSel}
                aria-label={isSel ? "Désélectionner" : "Sélectionner pour ajout"}
                onClick={() => toggle(r.id)}
                className={`absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold shadow-sm transition ${
                  isSel
                    ? "border-transparent text-white"
                    : "border-white/80 bg-black/30 text-transparent hover:bg-black/50"
                }`}
                style={isSel ? { backgroundColor: "var(--accent)" } : undefined}
              >
                {/* coche dessinée (pas d'emoji) */}
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3}>
                  <path d="M4 10l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>

      {(msg || error) && (
        <p
          className={`rounded-lg p-2 text-sm ${
            error
              ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          }`}
        >
          {error ?? msg}
        </p>
      )}

      {/* Barre d'action collante : n'apparaît qu'avec une sélection. */}
      {selected.size > 0 && (
        <div className="sticky bottom-3 z-10 flex items-center gap-3 rounded-2xl border border-[var(--bordure)] bg-white/95 p-3 shadow-lg backdrop-blur  /95">
          <span className="text-sm font-medium">
            {selected.size} sélectionnée{selected.size > 1 ? "s" : ""}
          </span>
          <button
            type="button"
            onClick={clear}
            disabled={pending}
            className="ml-auto rounded-lg border border-[var(--bordure)] px-3 py-2 text-sm disabled:opacity-50 "
          >
            Vider
          </button>
          <button
            type="button"
            onClick={addSelected}
            disabled={pending}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--accent)" }}
          >
            {pending ? "Ajout…" : "Ajouter à ma bibliothèque"}
          </button>
        </div>
      )}
    </>
  );
}
