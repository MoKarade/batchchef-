"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { recipesApi, type RecipeBrief } from "@/lib/api";
import { formatPrice, healthColor, mealTypeLabel } from "@/lib/utils";
import { Search, Leaf, Flame, Star } from "lucide-react";
import Link from "next/link";

const MEAL_TYPES = ["", "entree", "plat", "dessert", "snack"] as const;
const SORT_OPTIONS = [
  { value: "id_desc", label: "Plus récentes" },
  { value: "health_desc", label: "Plus saines" },
  { value: "cost_asc", label: "Moins chères" },
  { value: "cost_desc", label: "Plus chères" },
  { value: "title_asc", label: "Alphabétique" },
];

const HAS_PRICE_TABS = [
  { value: "all", label: "Toutes" },
  { value: "priced", label: "Avec prix" },
  { value: "missing", label: "Prix manquant" },
] as const;

function RecipeCard({ recipe }: { recipe: RecipeBrief }) {
  return (
    <Link href={`/recipes/${recipe.id}`}>
      <div className="rounded-xl border bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer h-full flex flex-col">
        {recipe.image_url ? (
          <div className="aspect-video relative overflow-hidden bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={recipe.image_url} alt={recipe.title} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="aspect-video bg-muted flex items-center justify-center text-4xl">🍽️</div>
        )}
        <div className="p-4 flex-1 flex flex-col gap-2">
          <p className="font-semibold text-sm leading-tight line-clamp-2">{recipe.title}</p>

          <div className="flex items-center gap-1.5 flex-wrap mt-auto">
            {recipe.meal_type && (
              <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium">
                {mealTypeLabel(recipe.meal_type)}
              </span>
            )}
            {recipe.is_vegetarian && (
              <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs flex items-center gap-0.5">
                <Leaf className="h-3 w-3" /> Végé
              </span>
            )}
            {recipe.is_spicy && (
              <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs flex items-center gap-0.5">
                <Flame className="h-3 w-3" /> Épicé
              </span>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{recipe.calories_per_portion ? `${Math.round(recipe.calories_per_portion)} kcal` : "—"}</span>
            {recipe.estimated_cost_per_portion != null && recipe.estimated_cost_per_portion > 0 ? (
              <span className="inline-flex items-center gap-1 font-mono font-bold text-green-700 dark:text-green-400">
                {formatPrice(recipe.estimated_cost_per_portion)}/portion
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-600 text-[10px]">
                Prix manquant
              </span>
            )}
            {recipe.health_score != null && (
              <span className={`flex items-center gap-0.5 font-medium ${healthColor(recipe.health_score)}`}>
                <Star className="h-3 w-3" />
                {recipe.health_score.toFixed(1)}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

export function RecipesPage() {
  const [search, setSearch] = useState("");
  const [mealType, setMealType] = useState("");
  const [sort, setSort] = useState("id_desc");
  const [hasPrice, setHasPrice] = useState<"all" | "priced" | "missing">("all");
  const [offset, setOffset] = useState(0);
  const LIMIT = 24;

  const { data, isLoading } = useQuery({
    queryKey: ["recipes", { search, mealType, sort, hasPrice, offset }],
    queryFn: () =>
      recipesApi
        .list({
          search: search || undefined,
          meal_type: mealType || undefined,
          sort,
          has_price: hasPrice,
          limit: LIMIT,
          offset,
        })
        .then((r) => r.data),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Recettes</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {data?.total ?? "—"} recettes importées
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            placeholder="Rechercher une recette..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
            className="flex h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 py-1 text-sm"
          />
        </div>

        <select
          value={mealType}
          onChange={(e) => { setMealType(e.target.value); setOffset(0); }}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Tous les types</option>
          {MEAL_TYPES.filter(Boolean).map((t) => (
            <option key={t} value={t}>{mealTypeLabel(t)}</option>
          ))}
        </select>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <div className="inline-flex rounded-md border border-input overflow-hidden h-9">
          {HAS_PRICE_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => { setHasPrice(t.value); setOffset(0); }}
              className={`px-3 text-xs font-medium ${
                hasPrice === t.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-accent"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-card h-64 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {data?.items.map((r) => <RecipeCard key={r.id} recipe={r} />)}
        </div>
      )}

      {/* Pagination */}
      {data && data.total > LIMIT && (
        <div className="flex items-center justify-center gap-3">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            className="px-3 h-8 rounded-md border text-sm disabled:opacity-40"
          >
            ← Précédent
          </button>
          <span className="text-sm text-muted-foreground">
            {Math.floor(offset / LIMIT) + 1} / {Math.ceil(data.total / LIMIT)}
          </span>
          <button
            disabled={offset + LIMIT >= data.total}
            onClick={() => setOffset(offset + LIMIT)}
            className="px-3 h-8 rounded-md border text-sm disabled:opacity-40"
          >
            Suivant →
          </button>
        </div>
      )}
    </div>
  );
}
