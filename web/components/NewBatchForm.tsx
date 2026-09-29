"use client";

// Composer un batch : cocher des recettes, choisir les portions de chacune.
// À la création : liste agrégée générée + estimation budget (best-effort, honnête).

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBatch } from "@/lib/actions/batch";

interface RecipeOption {
  id: number;
  title: string;
  servings: number;
}

export function NewBatchForm({ recipes }: { recipes: RecipeOption[] }) {
  const [name, setName] = useState("");
  const [portions, setPortions] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  // Batch créé mais estimation LLM tombée sur le filet déterministe : on le dit avant
  // de partir, plutôt que de rediriger en silence sur des prix moins précis.
  const [fallbackNotice, setFallbackNotice] = useState<{ id: number; error: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const toggle = (id: number, base: number) =>
    setPortions((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = base;
      return next;
    });

  if (fallbackNotice) {
    return (
      <div className="bandeau alerte" role="status">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3l10 18H2z" />
          <path d="M12 10v5M12 18v.5" />
        </svg>
        <div className="space-y-3 text-sm">
          <strong>Batch créé — budget approximatif.</strong>
          <p>
            L&apos;estimation précise par IA a échoué ({fallbackNotice.error}) : les prix viennent
            d&apos;un tarif moyen de secours, pas de l&apos;estimation habituelle. Tu peux les
            corriger dans la liste d&apos;épicerie.
          </p>
          <Link href={`/batchs/${fallbackNotice.id}`} className="bouton bouton-second">
            Voir le batch →
          </Link>
        </div>
      </div>
    );
  }

  if (recipes.length === 0) {
    return (
      <div className="vide">
        <h2>Ta bibliothèque est vide</h2>
        <p>Un batch se compose de recettes que tu as déjà.</p>
        <Link
          href="/catalogue"
          className="bouton bouton-principal"
        >
          Piger dans le catalogue
        </Link>
      </div>
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
          if (!res.id) {
            setError("Batch créé mais identifiant manquant — retourne à la liste des batchs.");
            return;
          }
          if (res.estimationError) {
            setFallbackNotice({ id: res.id, error: res.estimationError });
            return;
          }
          router.push(`/batchs/${res.id}`);
        });
      }}
    >
      <label className="etiquette" htmlFor="nom-batch">
        Nom du batch
      </label>
      <input
        id="nom-batch"
        type="text"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nom du batch (ex. Semaine du 28 juillet)"
        className="champ"
        disabled={pending}
      />

      <ul className="liste">
        {recipes.map((r) => {
          const selected = r.id in portions;
          return (
            <li key={r.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
              <input
                type="checkbox"
                id={`r-${r.id}`}
                checked={selected}
                onChange={() => toggle(r.id, r.servings)}
                className="h-6 w-6 shrink-0 accent-[var(--accent)]"
                disabled={pending}
              />
              <label htmlFor={`r-${r.id}`} className="min-w-0 flex-1 py-2 text-base">
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
                    className="champ w-16 text-center num"
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
        <p className="bandeau erreur" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || Object.keys(portions).length === 0 || !name.trim()}
        className="bouton bouton-principal w-full"
      >
        {pending ? "Génération de la liste…" : "Créer le batch"}
      </button>
      {!pending && (!name.trim() || Object.keys(portions).length === 0) && (
        <p className="text-center text-sm doux">
          {!name.trim() && Object.keys(portions).length === 0
            ? "Nomme le batch et coche au moins une recette pour l’activer."
            : !name.trim()
              ? "Donne un nom au batch pour l’activer."
              : "Coche au moins une recette pour l’activer."}
        </p>
      )}
      {pending && (
        <p className="text-center text-sm doux" role="status">
          Agrégation des ingrédients + estimation du budget (quelques secondes)…
        </p>
      )}
    </form>
  );
}
