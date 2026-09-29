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
  /** Difficulté estimée (SEM-05). `null` = non estimable ; la carte le dit. */
  difficulte: number | null;
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
      <ul className="grille g3">
        {recipes.map((r) => {
          const isSel = selected.has(r.id);
          return (
            <li key={r.id} className="relative">
              <RecipeCard
                href={`/catalogue/${r.id}`}
                title={r.title}
                imageUrl={r.imageUrl}
                difficulte={r.difficulte}
              />
              {/* Case de sélection AU-DESSUS du lien (coin) : cocher n'ouvre pas la recette. */}
              <button
                type="button"
                aria-pressed={isSel}
                aria-label={isSel ? "Désélectionner" : "Sélectionner pour ajout"}
                onClick={() => toggle(r.id)}
                // La case NON cochée est posée sur la PHOTO de la recette, pas sur une
                // surface du thème : son contraste se joue contre l'image, jamais contre
                // `--fond`. Blanc/noir en dur est donc le bon choix ici — c'est la seule
                // exception, et elle est nommée dans `tests/theme.test.ts`.
                // Zone tactile de 44 px ; le disque visible (32 px) est dedans.
                className="absolute left-1 top-1 flex h-11 w-11 items-center justify-center"
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold transition ${
                    isSel
                      ? "border-transparent sur-accent"
                      : "border-white/80 bg-black/30 text-transparent hover:bg-black/50"
                  }`}
                  style={isSel ? { backgroundColor: "var(--accent)" } : undefined}
                >
                  {/* coche dessinée (pas d'emoji) */}
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3}>
                    <path d="M4 10l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {(msg || error) && (
        <p className={`bandeau mt-4 ${error ? "erreur" : "succes"}`} role={error ? "alert" : "status"}>
          {error ?? msg}
        </p>
      )}

      {/* Barre d'action collante : n'apparaît qu'avec une sélection. */}
      {selected.size > 0 && (
        <div className="carte sticky bottom-24 z-10 mt-4 flex flex-wrap items-center gap-3 p-3 md:bottom-4">
          <span className="text-sm font-medium">
            {selected.size} sélectionnée{selected.size > 1 ? "s" : ""}
          </span>
          <button
            type="button"
            onClick={clear}
            disabled={pending}
            className="bouton bouton-second ml-auto"
          >
            Vider
          </button>
          <button
            type="button"
            onClick={addSelected}
            disabled={pending}
            className="bouton bouton-principal"
          >
            {pending ? "Ajout…" : "Ajouter à ma bibliothèque"}
          </button>
        </div>
      )}
    </>
  );
}
