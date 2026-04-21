"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { batchesApi, recipesApi } from "@/lib/api";
import { useRouter } from "next/navigation";
import { ChefHat, Loader2, X } from "lucide-react";

const MEAL_TYPES = [
  { value: "", label: "—" },
  { value: "entree", label: "Entrée" },
  { value: "plat", label: "Plat" },
  { value: "dessert", label: "Dessert" },
  { value: "snack", label: "Snack" },
];

export function BatchNewPage() {
  const [portions, setPortions] = useState(20);
  const [numRecipes, setNumRecipes] = useState(3);
  const [vegetarian, setVegetarian] = useState(false);
  const [vegan, setVegan] = useState(false);
  const [mealSequence, setMealSequence] = useState<string[]>(["plat", "plat", "plat"]);
  const [maxCost, setMaxCost] = useState<string>("");
  const [maxPrep, setMaxPrep] = useState<string>("");
  const [minHealth, setMinHealth] = useState<string>("");
  const [includeIds, setIncludeIds] = useState<number[]>([]);
  const [recipeSearch, setRecipeSearch] = useState("");

  const router = useRouter();
  const qc = useQueryClient();

  const { data: recipeSearchResults = [] } = useQuery({
    queryKey: ["recipe-search", recipeSearch],
    queryFn: () =>
      recipesApi
        .list({ search: recipeSearch || undefined, limit: 20 })
        .then((r) => r.data.items),
    enabled: recipeSearch.length >= 2,
  });

  const { data: includedRecipes = [] } = useQuery({
    queryKey: ["included-recipes", includeIds],
    queryFn: async () => {
      if (includeIds.length === 0) return [];
      const list = await Promise.all(includeIds.map((id) => recipesApi.get(id).then((r) => r.data)));
      return list;
    },
    enabled: includeIds.length > 0,
  });

  const mutation = useMutation({
    mutationFn: () =>
      batchesApi.generate({
        target_portions: portions,
        num_recipes: numRecipes,
        meal_type_sequence: mealSequence.slice(0, numRecipes).filter(Boolean).length > 0
          ? mealSequence.slice(0, numRecipes).map((m) => m || "plat")
          : null,
        vegetarian_only: vegetarian && !vegan,
        vegan_only: vegan,
        max_cost_per_portion: maxCost ? parseFloat(maxCost) : null,
        prep_time_max_min: maxPrep ? parseInt(maxPrep) : null,
        health_score_min: minHealth ? parseFloat(minHealth) : null,
        include_recipe_ids: includeIds.length > 0 ? includeIds : null,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["batches"] });
      router.push(`/batches/${res.data.id}`);
    },
  });

  const setMeal = (i: number, v: string) => {
    setMealSequence((prev) => {
      const next = [...prev];
      while (next.length <= i) next.push("");
      next[i] = v;
      return next;
    });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Générer un batch</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Configure les contraintes puis laisse l&apos;algorithme composer ton batch.
        </p>
      </div>

      {/* Base */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Base</h2>
        <div className="grid grid-cols-2 gap-4">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Portions cibles</span>
            <input
              type="number"
              min={3} max={60}
              value={portions}
              onChange={(e) => setPortions(parseInt(e.target.value) || 20)}
              className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Nombre de recettes (2–5)</span>
            <input
              type="number"
              min={2} max={5}
              value={numRecipes}
              onChange={(e) => setNumRecipes(Math.max(2, Math.min(5, parseInt(e.target.value) || 3)))}
              className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
            />
          </label>
        </div>
      </div>

      {/* Régime */}
      <div className="rounded-xl border bg-card p-6 space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Régime</h2>
        <div className="flex gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={vegetarian} onChange={(e) => setVegetarian(e.target.checked)} />
            Végétarien
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={vegan} onChange={(e) => { setVegan(e.target.checked); if (e.target.checked) setVegetarian(true); }} />
            Végan
          </label>
        </div>
      </div>

      {/* Meal sequence */}
      <div className="rounded-xl border bg-card p-6 space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Type de repas par recette
        </h2>
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: numRecipes }).map((_, i) => (
            <label key={i} className="space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">Recette {i + 1}</span>
              <select
                value={mealSequence[i] ?? ""}
                onChange={(e) => setMeal(i, e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                {MEAL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Laisse «—» pour ignorer la contrainte.</p>
      </div>

      {/* Contraintes */}
      <div className="rounded-xl border bg-card p-6 space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Contraintes</h2>
        <div className="grid grid-cols-3 gap-4">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Coût max ($/portion)</span>
            <input
              type="number" step="0.1" min={0}
              value={maxCost} onChange={(e) => setMaxCost(e.target.value)}
              placeholder="—"
              className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Temps préparation max (min)</span>
            <input
              type="number" min={0}
              value={maxPrep} onChange={(e) => setMaxPrep(e.target.value)}
              placeholder="—"
              className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Santé min (/10)</span>
            <input
              type="number" step="0.5" min={0} max={10}
              value={minHealth} onChange={(e) => setMinHealth(e.target.value)}
              placeholder="—"
              className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
            />
          </label>
        </div>
      </div>

      {/* Forced recipes */}
      <div className="rounded-xl border bg-card p-6 space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Recettes imposées (optionnel)
        </h2>
        <input
          type="text"
          value={recipeSearch}
          onChange={(e) => setRecipeSearch(e.target.value)}
          placeholder="Rechercher par titre..."
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        />
        {recipeSearch.length >= 2 && recipeSearchResults.length > 0 && (
          <div className="max-h-40 overflow-auto border rounded-md divide-y">
            {recipeSearchResults.filter((r) => !includeIds.includes(r.id)).map((r) => (
              <button
                key={r.id}
                onClick={() => { setIncludeIds([...includeIds, r.id]); setRecipeSearch(""); }}
                className="w-full text-left text-sm px-3 py-2 hover:bg-accent"
              >
                {r.title}
              </button>
            ))}
          </div>
        )}
        {includedRecipes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {includedRecipes.map((r) => (
              <span key={r.id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs">
                {r.title}
                <button onClick={() => setIncludeIds(includeIds.filter((id) => id !== r.id))}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {mutation.isError && (
        <p className="text-sm text-destructive">
          {(mutation.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            ?? "Erreur lors de la génération."}
        </p>
      )}

      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="w-full flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground h-11 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        {mutation.isPending ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Génération en cours...</>
        ) : (
          <><ChefHat className="h-4 w-4" /> Générer le batch</>
        )}
      </button>
    </div>
  );
}
