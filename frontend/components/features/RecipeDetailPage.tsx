"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ExternalLink, Clock, Flame, Leaf, Star, Utensils,
  CheckCircle2, AlertCircle, X, Minus, Plus, Users,
} from "lucide-react";
import { recipesApi, ingredientsApi, type IngredientMaster } from "@/lib/api";
import { formatPrice, formatDuration, healthColor, mealTypeLabel, categoryEmoji } from "@/lib/utils";

/**
 * Smart back button — uses browser history (so you return to /batch,
 * /recipes, or wherever you came from) with a safe fallback to /recipes
 * when history is empty (e.g. direct-link visit).
 */
function SmartBackLink({ label }: { label: string }) {
  const router = useRouter();
  const handle = (e: React.MouseEvent) => {
    e.preventDefault();
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/recipes");
    }
  };
  return (
    <Link
      href="/recipes"
      onClick={handle}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-3 w-3" /> {label}
    </Link>
  );
}

function IngredientPicker({
  currentId,
  rawText,
  onPick,
}: {
  currentId: number | null | undefined;
  rawText?: string;
  onPick: (id: number | null, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const { data: matches = [] } = useQuery({
    queryKey: ["ing-search", query],
    queryFn: () => ingredientsApi.list({ search: query || undefined, limit: 12 }).then((r) => r.data),
    enabled: open,
  });

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen((v) => !v); setQuery(""); }}
        className="text-xs px-2 h-7 rounded-md border hover:bg-accent"
      >
        Remapper
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-md border bg-popover shadow-lg p-2 space-y-1">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={rawText ? `Cherche pour « ${rawText} »` : "Rechercher…"}
            className="h-8 w-full rounded-md border bg-background px-2 text-xs"
          />
          <div className="max-h-60 overflow-auto">
            {currentId && (
              <button
                onClick={() => { onPick(null, ""); setOpen(false); }}
                className="w-full text-left text-xs px-2 py-1 rounded hover:bg-accent text-muted-foreground flex items-center gap-1"
              >
                <X className="h-3 w-3" /> Désassigner
              </button>
            )}
            {matches.map((ing: IngredientMaster) => (
              <button
                key={ing.id}
                onClick={() => { onPick(ing.id, ing.display_name_fr); setOpen(false); }}
                className="w-full text-left text-xs px-2 py-1 rounded hover:bg-accent flex items-center gap-2"
              >
                <span>{categoryEmoji(ing.category)}</span>
                <span className="flex-1 truncate">{ing.display_name_fr}</span>
                {ing.category && <span className="text-muted-foreground">{ing.category}</span>}
              </button>
            ))}
            {matches.length === 0 && query && (
              <p className="text-xs text-muted-foreground px-2 py-1">Aucun résultat.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function RecipeDetailPage({ recipeId }: { recipeId: number }) {
  const qc = useQueryClient();
  const [portions, setPortions] = useState(4);

  const { data: recipe, isLoading, isError } = useQuery({
    queryKey: ["recipe", recipeId],
    queryFn: () => recipesApi.get(recipeId).then((r) => r.data),
  });

  const updateIng = useMutation({
    mutationFn: (vars: { riId: number; ingredient_master_id: number | null }) =>
      recipesApi.updateIngredient(recipeId, vars.riId, {
        ingredient_master_id: vars.ingredient_master_id,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recipe", recipeId] }),
  });

  if (isLoading) return <div className="max-w-5xl h-64 rounded-xl border bg-card animate-pulse" />;
  if (isError || !recipe) {
    return (
      <div className="max-w-2xl space-y-3">
        <SmartBackLink label="Retour" />
        <p className="rounded-md border bg-destructive/10 text-destructive p-4 text-sm">
          Recette introuvable (#{recipeId}).
        </p>
      </div>
    );
  }

  const mapped = recipe.ingredients.filter(
    (i) => i.ingredient && i.ingredient.price_mapping_status === "mapped",
  ).length;
  const total = recipe.ingredients.length;

  const instructions = recipe.instructions
    ? recipe.instructions.split(/\n+/).filter((s) => s.trim())
    : [];

  return (
    <div className="space-y-5 max-w-5xl">
      <SmartBackLink label="Retour" />

      {/* Header */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="grid md:grid-cols-[320px_1fr]">
          {recipe.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={recipe.image_url} alt={recipe.title} className="w-full h-full object-cover aspect-video md:aspect-auto" />
          ) : (
            <div className="aspect-video md:aspect-auto bg-muted flex items-center justify-center text-6xl">🍽️</div>
          )}
          <div className="p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <h1 className="title-serif text-3xl font-bold">{recipe.title}</h1>
              <a
                href={recipe.marmiton_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
              >
                Marmiton <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {recipe.meal_type && (
                <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium">
                  {mealTypeLabel(recipe.meal_type)}
                </span>
              )}
              {recipe.is_vegan ? (
                <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs flex items-center gap-0.5">
                  <Leaf className="h-3 w-3" /> Végan
                </span>
              ) : recipe.is_vegetarian && (
                <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs flex items-center gap-0.5">
                  <Leaf className="h-3 w-3" /> Végé
                </span>
              )}
              {recipe.is_spicy && (
                <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs flex items-center gap-0.5">
                  <Flame className="h-3 w-3" /> Épicé
                </span>
              )}
              {recipe.cuisine_type && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{recipe.cuisine_type}</span>
              )}
              {recipe.difficulty && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{recipe.difficulty}</span>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 text-sm">
              <Stat icon={<Clock className="h-4 w-4" />} label="Préparation" value={formatDuration(recipe.prep_time_min)} />
              <Stat icon={<Utensils className="h-4 w-4" />} label="Cuisson" value={formatDuration(recipe.cook_time_min)} />
              <Stat
                icon={<Star className="h-4 w-4" />}
                label="Santé"
                value={recipe.health_score != null ? recipe.health_score.toFixed(1) : "—"}
                valueClass={healthColor(recipe.health_score)}
              />
              <Stat label="Coût / portion" value={formatPrice(recipe.estimated_cost_per_portion)} />
            </div>

            {(recipe.calories_per_portion || recipe.proteins_per_portion) && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                {recipe.calories_per_portion != null && <span>{Math.round(recipe.calories_per_portion)} kcal</span>}
                {recipe.proteins_per_portion != null && <span>{recipe.proteins_per_portion.toFixed(0)} g protéines</span>}
                {recipe.carbs_per_portion != null && <span>{recipe.carbs_per_portion.toFixed(0)} g glucides</span>}
                {recipe.lipids_per_portion != null && <span>{recipe.lipids_per_portion.toFixed(0)} g lipides</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-[1fr_1.2fr] gap-5">
        {/* Ingredients */}
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">Ingrédients</h2>
            <span className={`text-xs rounded-full px-2 py-0.5 ${
              mapped === total ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
            }`}>
              {mapped}/{total} mappés
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Pour</span>
            <div className="inline-flex items-center rounded-md border overflow-hidden">
              <button
                onClick={() => setPortions((p) => Math.max(1, p - 1))}
                className="h-7 w-7 inline-flex items-center justify-center hover:bg-accent"
                aria-label="Moins"
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="px-3 font-semibold tabular-nums">{portions}</span>
              <button
                onClick={() => setPortions((p) => Math.min(60, p + 1))}
                className="h-7 w-7 inline-flex items-center justify-center hover:bg-accent"
                aria-label="Plus"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <span className="text-muted-foreground">{portions > 1 ? "portions" : "portion"}</span>
          </div>
          <ul className="divide-y">
            {recipe.ingredients.map((ri) => {
              const isLinked = !!ri.ingredient;
              const isMapped = isLinked && ri.ingredient?.price_mapping_status === "mapped";
              return (
                <li key={ri.id} className="py-2 flex items-start gap-3">
                  <div className="text-2xl w-8 text-center shrink-0 leading-none pt-0.5">
                    {categoryEmoji(ri.ingredient?.category)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-sm truncate">
                        {ri.ingredient?.display_name_fr ?? ri.raw_text ?? "—"}
                      </span>
                      {isMapped ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" aria-label="Mappé" />
                      ) : isLinked ? (
                        <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-label="Lié mais prix non mappé" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" aria-label="Non lié" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatQtyUnit(ri.quantity_per_portion, portions, ri.unit)}
                      {ri.note ? ` · ${ri.note}` : ""}
                    </p>
                  </div>
                  <IngredientPicker
                    currentId={ri.ingredient?.id}
                    rawText={ri.raw_text}
                    onPick={(id) => updateIng.mutate({ riId: ri.id, ingredient_master_id: id })}
                  />
                </li>
              );
            })}
          </ul>
        </div>

        {/* Instructions */}
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <h2 className="text-lg font-semibold">Préparation</h2>
          {instructions.length > 0 ? (
            <ol className="space-y-3 text-sm leading-relaxed">
              {instructions.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">Aucune instruction disponible.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function formatQty(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (n < 0.1) return n.toFixed(3).replace(/\.?0+$/, "");
  if (n < 10) return n.toFixed(2).replace(/\.?0+$/, "");
  return Math.round(n).toString();
}

// Compose "[qty] [unit]" hiding noise: no "unite"/"unites" label, no missing qty.
function formatQtyUnit(qtyPerPortion: number | null | undefined, portions: number, unit?: string | null): string {
  if (qtyPerPortion == null) return unit ?? "";
  const q = formatQty(qtyPerPortion * portions);
  const u = unit && unit !== "unite" && unit !== "unites" ? unit : "";
  return u ? `${q} ${u}` : q;
}

function Stat({
  icon, label, value, valueClass,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</p>
      <p className={`font-medium ${valueClass ?? ""}`}>{value}</p>
    </div>
  );
}
