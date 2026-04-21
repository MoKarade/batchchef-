"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, Check, X, Loader2 } from "lucide-react";
import { recipesApi, type RecipeBrief } from "@/lib/api";
import { mealTypeLabel, healthColor } from "@/lib/utils";
import { RecipeModal } from "./RecipeModal";

const MEAL_TYPES = [
  { value: "", label: "Tous types" },
  { value: "entree", label: "Entrée" },
  { value: "plat", label: "Plat" },
  { value: "dessert", label: "Dessert" },
  { value: "snack", label: "Snack" },
];

interface Props {
  slot: number;
  pickedRecipe: RecipeBrief | null;
  excludeIds: number[];
  onPick: (recipe: RecipeBrief) => void;
  onClear: () => void;
}

export function RecipeSlotPicker({ slot, pickedRecipe, excludeIds, onPick, onClear }: Props) {
  const [search, setSearch] = useState("");
  const [mealType, setMealType] = useState("");
  const [tag, setTag] = useState("");
  const [maxCost, setMaxCost] = useState("");
  const [maxPrep, setMaxPrep] = useState("");
  const [minHealth, setMinHealth] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["slot-search", search, mealType, tag, maxCost, maxPrep, minHealth],
    queryFn: () =>
      recipesApi
        .list({
          search: search || undefined,
          meal_type: mealType || undefined,
          tag: tag || undefined,
          status: "ai_done",
          max_cost_per_portion: maxCost ? parseFloat(maxCost) : undefined,
          prep_time_max_min: maxPrep ? parseInt(maxPrep) : undefined,
          health_score_min: minHealth ? parseFloat(minHealth) : undefined,
          sort: "health_desc",
          limit: 30,
        })
        .then((r) => r.data.items),
    enabled: !pickedRecipe,
  });

  const items = (data ?? []).filter((r) => !excludeIds.includes(r.id));

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Recette {slot + 1}</h3>
        {pickedRecipe && (
          <button
            onClick={onClear}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <X className="h-3 w-3" /> Changer
          </button>
        )}
      </div>

      {pickedRecipe ? (
        <div className="flex items-start gap-3">
          {pickedRecipe.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pickedRecipe.image_url}
              alt={pickedRecipe.title}
              className="w-20 h-20 object-cover rounded-md shrink-0"
            />
          ) : (
            <div className="w-20 h-20 bg-muted rounded-md flex items-center justify-center text-2xl shrink-0">🍽️</div>
          )}
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-medium truncate">{pickedRecipe.title}</p>
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              {pickedRecipe.meal_type && (
                <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5">
                  {mealTypeLabel(pickedRecipe.meal_type)}
                </span>
              )}
              {pickedRecipe.health_score != null && (
                <span className={`${healthColor(pickedRecipe.health_score)}`}>
                  ★ {pickedRecipe.health_score.toFixed(1)}
                </span>
              )}
            </div>
            <button
              onClick={() => setOpenId(pickedRecipe.id)}
              className="text-xs px-2 h-7 rounded-md border hover:bg-accent inline-flex items-center gap-1"
            >
              <Eye className="h-3 w-3" /> Aperçu
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher…"
              className="h-8 rounded-md border bg-background px-2 text-xs col-span-2 md:col-span-3"
            />
            <select
              value={mealType}
              onChange={(e) => setMealType(e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-xs"
            >
              {MEAL_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <select
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-xs"
            >
              <option value="">Tous régimes</option>
              <option value="vegetarian">Végétarien</option>
              <option value="vegan">Végan</option>
            </select>
            <input
              type="number" step="0.5" min={0} max={10}
              value={minHealth}
              onChange={(e) => setMinHealth(e.target.value)}
              placeholder="Santé min"
              className="h-8 rounded-md border bg-background px-2 text-xs"
            />
            <input
              type="number" step="0.5" min={0}
              value={maxCost}
              onChange={(e) => setMaxCost(e.target.value)}
              placeholder="Coût max $"
              className="h-8 rounded-md border bg-background px-2 text-xs"
            />
            <input
              type="number" min={0}
              value={maxPrep}
              onChange={(e) => setMaxPrep(e.target.value)}
              placeholder="Prép max min"
              className="h-8 rounded-md border bg-background px-2 text-xs col-span-2 md:col-span-1"
            />
          </div>

          <div className="max-h-72 overflow-y-auto divide-y border rounded-md">
            {isLoading ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Chargement…
              </div>
            ) : items.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground text-center">Aucune recette trouvée.</p>
            ) : (
              items.map((r) => (
                <div key={r.id} className="flex items-center gap-2 p-2 hover:bg-accent/50">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{r.title}</p>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                      {r.meal_type && <span>{mealTypeLabel(r.meal_type)}</span>}
                      {r.health_score != null && (
                        <span className={healthColor(r.health_score)}>★ {r.health_score.toFixed(1)}</span>
                      )}
                      {r.estimated_cost_per_portion != null && (
                        <span>{r.estimated_cost_per_portion.toFixed(2)} $/p</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setOpenId(r.id)}
                    className="text-xs h-7 w-7 rounded-md border hover:bg-accent inline-flex items-center justify-center"
                    aria-label="Aperçu"
                  >
                    <Eye className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => onPick(r)}
                    className="text-xs h-7 px-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1"
                  >
                    <Check className="h-3 w-3" /> Choisir
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}

      <RecipeModal recipeId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
