"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  X, ExternalLink, Clock, Flame, Leaf, Star, Utensils,
  CheckCircle2, AlertCircle,
} from "lucide-react";
import { recipesApi } from "@/lib/api";
import { formatPrice, formatDuration, healthColor, mealTypeLabel, categoryEmoji } from "@/lib/utils";

interface Props {
  recipeId: number | null;
  portions?: number;
  onClose: () => void;
}

export function RecipeModal({ recipeId, portions = 1, onClose }: Props) {
  const { data: recipe, isLoading } = useQuery({
    queryKey: ["recipe", recipeId],
    queryFn: () => recipesApi.get(recipeId as number).then((r) => r.data),
    enabled: recipeId != null,
  });

  useEffect(() => {
    if (recipeId == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [recipeId, onClose]);

  if (recipeId == null) return null;

  const instructions = recipe?.instructions
    ? recipe.instructions.split(/\n+/).filter((s) => s.trim())
    : [];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative bg-background rounded-xl border shadow-2xl w-full max-w-4xl my-8 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 h-9 w-9 rounded-full bg-background/90 border shadow-sm hover:bg-accent inline-flex items-center justify-center"
          aria-label="Fermer"
        >
          <X className="h-4 w-4" />
        </button>

        {isLoading || !recipe ? (
          <div className="h-96 animate-pulse" />
        ) : (
          <div className="space-y-5 p-5">
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="grid md:grid-cols-[260px_1fr]">
                {recipe.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={recipe.image_url}
                    alt={recipe.title}
                    className="w-full h-full object-cover aspect-video md:aspect-auto"
                  />
                ) : (
                  <div className="aspect-video md:aspect-auto bg-muted flex items-center justify-center text-6xl">🍽️</div>
                )}
                <div className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-xl font-bold tracking-tight pr-10">{recipe.title}</h2>
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
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1 text-sm">
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
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-[1fr_1.2fr] gap-5">
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold">Ingrédients</h3>
                  <span className="text-xs text-muted-foreground">pour {portions} portion{portions > 1 ? "s" : ""}</span>
                </div>
                <ul className="divide-y">
                  {recipe.ingredients.map((ri) => {
                    const isLinked = !!ri.ingredient;
                    const isMapped = isLinked && ri.ingredient?.price_mapping_status === "mapped";
                    return (
                      <li key={ri.id} className="py-2 flex items-start gap-3">
                        <div className="text-xl w-7 text-center shrink-0 leading-none pt-0.5">
                          {categoryEmoji(ri.ingredient?.category)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="font-medium text-sm truncate">
                              {ri.ingredient?.display_name_fr ?? ri.raw_text ?? "—"}
                            </span>
                            {isMapped ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                            ) : isLinked ? (
                              <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                            ) : (
                              <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatQtyUnit(ri.quantity_per_portion, portions, ri.unit)}
                            {ri.note ? ` · ${ri.note}` : ""}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="rounded-xl border bg-card p-4 space-y-3">
                <h3 className="text-base font-semibold">Préparation</h3>
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
        )}
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
