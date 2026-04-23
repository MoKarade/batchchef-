"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { recipesApi, ingredientsApi, type RecipeBrief, type IngredientMaster } from "@/lib/api";
import { formatPrice, healthColor, mealTypeLabel } from "@/lib/utils";
import { Search, Leaf, Flame, Star, Plus, Check, X, Filter } from "lucide-react";
import Link from "next/link";
import { addToCart, isInCart, useCart } from "@/lib/cart";

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

/**
 * Ingredient chip picker — typeahead search into the canonical catalogue
 * (parent_id IS NULL), added as removable pills. Supports two sets:
 * "inclure" (recipe must contain) and "exclure" (recipe must NOT contain).
 */
function IngredientChipPicker({
  label,
  tone,
  selected,
  onAdd,
  onRemove,
}: {
  label: string;
  tone: "include" | "exclude";
  selected: IngredientMaster[];
  onAdd: (ing: IngredientMaster) => void;
  onRemove: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const { data: suggestions = [] } = useQuery({
    queryKey: ["ingredient-suggest", query],
    queryFn: () =>
      ingredientsApi
        .list({
          search: query || undefined,
          parent_id: "null",
          limit: 8,
        })
        .then((r) => r.data),
    enabled: open && query.trim().length >= 1,
    staleTime: 30_000,
  });

  const toneCls =
    tone === "include"
      ? "bg-primary/15 text-primary border-primary/30 hover:bg-primary/25"
      : "bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/25";

  const selectedIds = new Set(selected.map((s) => s.id));
  const filtered = suggestions.filter((s) => !selectedIds.has(s.id));

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mr-1">
          {label}
        </span>
        {selected.map((ing) => (
          <span
            key={ing.id}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${toneCls}`}
          >
            {ing.display_name_fr}
            <button
              onClick={() => onRemove(ing.id)}
              aria-label="Retirer"
              className="ml-0.5 h-4 w-4 rounded-full hover:bg-background/30 inline-flex items-center justify-center"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <div className="relative inline-block">
          <input
            placeholder="+ ajouter"
            value={query}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 w-28 rounded-full border border-dashed border-input bg-background px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {open && filtered.length > 0 && (
            <div className="absolute z-20 left-0 top-9 w-56 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-lg">
              {filtered.map((ing) => (
                <button
                  key={ing.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onAdd(ing);
                    setQuery("");
                    setOpen(false);
                  }}
                  className="w-full text-left text-xs px-3 py-1.5 hover:bg-accent transition-colors block"
                >
                  <span className="font-medium">{ing.display_name_fr}</span>
                  <span className="text-muted-foreground ml-1 font-mono text-[10px]">
                    ({ing.canonical_name})
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RecipeCard({ recipe }: { recipe: RecipeBrief }) {
  const hasPrice = recipe.estimated_cost_per_portion != null && recipe.estimated_cost_per_portion > 0;
  // Re-read the cart on every render so the button state updates immediately
  // after clicking (useCart subscribes to the custom event).
  useCart();
  const inCart = isInCart(recipe.id);

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addToCart({
      recipe_id: recipe.id,
      title: recipe.title,
      image_url: recipe.image_url,
      cost_per_portion: recipe.estimated_cost_per_portion,
      health_score: recipe.health_score,
      meal_type: recipe.meal_type,
    });
  };

  return (
    <Link href={`/recipes/${recipe.id}`} className="group block h-full">
      <article className="relative h-full flex flex-col overflow-hidden rounded-2xl bg-card border border-border shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200">
        {/* Hero image, bigger + overlay gradient for readability */}
        <div className="relative aspect-[16/10] overflow-hidden bg-muted">
          {recipe.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={recipe.image_url}
              alt={recipe.title}
              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-5xl bg-gradient-to-br from-accent/40 to-muted">
              🍽️
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />

          {/* Health score top-right badge (if present) */}
          {recipe.health_score != null && (
            <div className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-background/90 backdrop-blur px-2 py-0.5 text-[11px] font-semibold shadow">
              <Star className={`h-3 w-3 ${healthColor(recipe.health_score)}`} />
              <span className={healthColor(recipe.health_score)}>{recipe.health_score.toFixed(1)}</span>
            </div>
          )}

          {/* Price bottom-left over gradient */}
          {hasPrice ? (
            <div className="absolute left-2 bottom-2 inline-flex items-baseline gap-1 rounded-full bg-background/95 backdrop-blur px-2.5 py-1 text-xs font-bold shadow">
              <span className="font-serif text-secondary">{formatPrice(recipe.estimated_cost_per_portion!)}</span>
              <span className="text-[10px] text-muted-foreground font-normal">/portion</span>
            </div>
          ) : (
            <div className="absolute left-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-amber-500/90 text-white px-2 py-0.5 text-[10px] font-medium shadow">
              Prix manquant
            </div>
          )}

          {/* Diet badges bottom-right over gradient */}
          <div className="absolute right-2 bottom-2 flex items-center gap-1">
            {recipe.is_vegetarian && (
              <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-secondary/95 text-secondary-foreground shadow" title="Végétarien">
                <Leaf className="h-3 w-3" />
              </span>
            )}
            {recipe.is_spicy && (
              <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-destructive/95 text-destructive-foreground shadow" title="Épicé">
                <Flame className="h-3 w-3" />
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-4 flex-1 flex flex-col gap-2">
          <h3 className="title-serif font-semibold text-base leading-tight line-clamp-2 text-foreground group-hover:text-primary transition-colors">
            {recipe.title}
          </h3>

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-auto">
            {recipe.meal_type && (
              <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                {mealTypeLabel(recipe.meal_type)}
              </span>
            )}
            <span className="ml-auto">
              {recipe.calories_per_portion ? `${Math.round(recipe.calories_per_portion)} kcal` : "—"}
            </span>
          </div>
        </div>

        {/* + au panier button — bottom-right of the card, doesn't navigate */}
        <button
          onClick={handleAdd}
          aria-label={inCart ? "Déjà dans le panier" : "Ajouter au panier"}
          className={`
            absolute top-2 left-2 inline-flex items-center justify-center
            h-9 w-9 rounded-full shadow-lg transition-all
            ${inCart
              ? "bg-secondary text-secondary-foreground hover:bg-secondary/90"
              : "bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-110"}
          `}
        >
          {inCart ? <Check className="h-4 w-4" /> : <Plus className="h-5 w-5" />}
        </button>
      </article>
    </Link>
  );
}

export function RecipesPage() {
  const [search, setSearch] = useState("");
  const [mealType, setMealType] = useState("");
  const [sort, setSort] = useState("id_desc");
  const [hasPrice, setHasPrice] = useState<"all" | "priced" | "missing">("all");
  const [offset, setOffset] = useState(0);
  // Ingredient filter chips — recipes must contain ALL of these parents.
  const [includedIngs, setIncludedIngs] = useState<IngredientMaster[]>([]);
  const [excludedIngs, setExcludedIngs] = useState<IngredientMaster[]>([]);
  const LIMIT = 24;

  const includeIds = includedIngs.map((i) => i.id);
  const excludeIds = excludedIngs.map((i) => i.id);

  const { data, isLoading } = useQuery({
    queryKey: ["recipes", { search, mealType, sort, hasPrice, offset, includeIds, excludeIds }],
    queryFn: () =>
      recipesApi
        .list({
          search: search || undefined,
          meal_type: mealType || undefined,
          sort,
          has_price: hasPrice,
          limit: LIMIT,
          offset,
          include_ingredient_ids: includeIds.length ? includeIds : undefined,
          exclude_ingredient_ids: excludeIds.length ? excludeIds : undefined,
          ingredient_match: "all",
        })
        .then((r) => r.data),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="title-serif text-3xl md:text-4xl font-bold tracking-tight">
            Recettes
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {data?.total ?? "—"} recettes Marmiton importées, standardisées et mises en prix
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

      {/* Ingredient chip filter — a dedicated row so chips wrap cleanly */}
      <div className="rounded-xl border bg-card/50 p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          <span>
            Filtrer par ingrédients — la recette doit contenir <strong>tous</strong> les
            inclus et <strong>aucun</strong> des exclus.
          </span>
        </div>
        <IngredientChipPicker
          label="Inclure"
          tone="include"
          selected={includedIngs}
          onAdd={(ing) => {
            setOffset(0);
            setIncludedIngs((prev) =>
              prev.some((x) => x.id === ing.id) ? prev : [...prev, ing],
            );
          }}
          onRemove={(id) => {
            setOffset(0);
            setIncludedIngs((prev) => prev.filter((x) => x.id !== id));
          }}
        />
        <IngredientChipPicker
          label="Exclure"
          tone="exclude"
          selected={excludedIngs}
          onAdd={(ing) => {
            setOffset(0);
            setExcludedIngs((prev) =>
              prev.some((x) => x.id === ing.id) ? prev : [...prev, ing],
            );
          }}
          onRemove={(id) => {
            setOffset(0);
            setExcludedIngs((prev) => prev.filter((x) => x.id !== id));
          }}
        />
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
