"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { batchesApi, type BatchPreview, type RecipeBrief } from "@/lib/api";
import { ChefHat, Loader2, Sparkles, Hand } from "lucide-react";
import { RecipeSlotPicker } from "./RecipeSlotPicker";
import { BatchPreviewStep } from "./BatchPreviewStep";

const MEAL_TYPES = [
  { value: "", label: "—" },
  { value: "entree", label: "Entrée" },
  { value: "plat", label: "Plat" },
  { value: "dessert", label: "Dessert" },
  { value: "snack", label: "Snack" },
];

type Step = "configure" | "preview";
type Mode = "auto" | "manual";

export function BatchNewPage() {
  const [step, setStep] = useState<Step>("configure");
  const [mode, setMode] = useState<Mode>("auto");
  const [preview, setPreview] = useState<BatchPreview | null>(null);

  const [portions, setPortions] = useState(20);
  const [numRecipes, setNumRecipes] = useState(3);
  const [vegetarian, setVegetarian] = useState(false);
  const [vegan, setVegan] = useState(false);
  const [mealSequence, setMealSequence] = useState<string[]>(["plat", "plat", "plat"]);
  const [maxCost, setMaxCost] = useState<string>("");
  const [maxPrep, setMaxPrep] = useState<string>("");
  const [minHealth, setMinHealth] = useState<string>("");

  const [pickedRecipes, setPickedRecipes] = useState<(RecipeBrief | null)[]>(
    Array(3).fill(null)
  );

  const previewMut = useMutation({
    mutationFn: () => {
      const includeIds = mode === "manual"
        ? pickedRecipes.filter((r): r is RecipeBrief => r != null).map((r) => r.id)
        : null;

      return batchesApi.preview({
        target_portions: portions,
        num_recipes: numRecipes,
        meal_type_sequence:
          mode === "auto" && mealSequence.slice(0, numRecipes).filter(Boolean).length > 0
            ? mealSequence.slice(0, numRecipes).map((m) => m || "plat")
            : null,
        vegetarian_only: mode === "auto" && vegetarian && !vegan,
        vegan_only: mode === "auto" && vegan,
        max_cost_per_portion: mode === "auto" && maxCost ? parseFloat(maxCost) : null,
        prep_time_max_min: mode === "auto" && maxPrep ? parseInt(maxPrep) : null,
        health_score_min: mode === "auto" && minHealth ? parseFloat(minHealth) : null,
        include_recipe_ids: includeIds,
      });
    },
    onSuccess: (res) => {
      setPreview(res.data);
      setStep("preview");
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

  const setPicked = (i: number, recipe: RecipeBrief | null) => {
    setPickedRecipes((prev) => {
      const next = [...prev];
      while (next.length <= i) next.push(null);
      next[i] = recipe;
      return next;
    });
  };

  const onChangeNumRecipes = (n: number) => {
    const v = Math.max(2, Math.min(5, n || 3));
    setNumRecipes(v);
    setPickedRecipes((prev) => {
      const next = [...prev];
      while (next.length < v) next.push(null);
      return next.slice(0, v);
    });
  };

  if (step === "preview" && preview) {
    return (
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="title-serif text-3xl font-bold">Aperçu du batch</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Vérifie les recettes et la liste de courses avant de créer le batch.
          </p>
        </div>
        <BatchPreviewStep preview={preview} onBack={() => setStep("configure")} />
      </div>
    );
  }

  const allSlotsFilled = mode === "manual"
    ? pickedRecipes.slice(0, numRecipes).every((r) => r != null)
    : true;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="title-serif text-3xl font-bold">Générer un batch</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Configure les contraintes puis prévisualise ton batch avant de l&apos;accepter.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-2 inline-flex gap-1">
        <button
          onClick={() => setMode("auto")}
          className={`px-4 h-9 rounded-md text-sm inline-flex items-center gap-2 ${
            mode === "auto" ? "bg-primary text-primary-foreground" : "hover:bg-accent"
          }`}
        >
          <Sparkles className="h-4 w-4" /> Automatique
        </button>
        <button
          onClick={() => setMode("manual")}
          className={`px-4 h-9 rounded-md text-sm inline-flex items-center gap-2 ${
            mode === "manual" ? "bg-primary text-primary-foreground" : "hover:bg-accent"
          }`}
        >
          <Hand className="h-4 w-4" /> Manuel (par plat)
        </button>
      </div>

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
              onChange={(e) => onChangeNumRecipes(parseInt(e.target.value))}
              className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
            />
          </label>
        </div>
      </div>

      {mode === "auto" ? (
        <>
          <div className="rounded-xl border bg-card p-6 space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Régime</h2>
            <div className="flex gap-6 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={vegetarian} onChange={(e) => setVegetarian(e.target.checked)} />
                Végétarien
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox" checked={vegan}
                  onChange={(e) => { setVegan(e.target.checked); if (e.target.checked) setVegetarian(true); }}
                />
                Végan
              </label>
            </div>
          </div>

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
                <span className="font-medium">Préparation max (min)</span>
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
        </>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Choisir chaque plat
          </h2>
          {Array.from({ length: numRecipes }).map((_, i) => (
            <RecipeSlotPicker
              key={i}
              slot={i}
              pickedRecipe={pickedRecipes[i] ?? null}
              excludeIds={pickedRecipes
                .filter((r): r is RecipeBrief => r != null)
                .map((r) => r.id)}
              onPick={(r) => setPicked(i, r)}
              onClear={() => setPicked(i, null)}
            />
          ))}
        </div>
      )}

      {previewMut.isError && (
        <p className="text-sm text-destructive">
          {(previewMut.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            ?? "Erreur lors de la prévisualisation."}
        </p>
      )}

      <button
        onClick={() => previewMut.mutate()}
        disabled={previewMut.isPending || !allSlotsFilled}
        className="w-full flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground h-11 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        {previewMut.isPending ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Prévisualisation…</>
        ) : !allSlotsFilled ? (
          <>Choisis toutes les recettes</>
        ) : (
          <><ChefHat className="h-4 w-4" /> Prévisualiser le batch</>
        )}
      </button>
    </div>
  );
}
