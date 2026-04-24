"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  Sparkles, ChefHat, RefreshCw, Snowflake, AlertTriangle,
  Leaf, Star, Plus, Minus, Package, ExternalLink, Utensils,
} from "lucide-react";
import { batchesApi, type BatchPreview, type ShoppingItemPreview, type IngredientMaster } from "@/lib/api";
import { formatPrice, healthColor, mealTypeLabel } from "@/lib/utils";
import { IngredientChipPicker } from "@/components/shared/IngredientChipPicker";
import { AllergyFilter } from "@/components/shared/AllergyFilter";

/**
 * Auto-batch flow — ask the backend to propose a batch based on filters,
 * preview it, and either regenerate (re-roll, excluding current) or accept
 * (persist the real batch).
 *
 * Key features:
 *   - Inventory priority ON by default → uses what's in the fridge first
 *   - Filter chips: vegetarian, vegan, max $/portion, prep time, health min
 *   - Portions + num_recipes sliders
 *   - Each regen excludes the current recipes so you actually see variety
 */
// sessionStorage key for the in-flight Auto batch preview. The user reported
// that navigating to a recipe detail and hitting Back wiped their preview —
// React unmounts this page on navigation so useState is lost. We persist
// the whole shape (filters + current preview) so Back restores everything.
// The draft is cleared on accept (see `accept.onSuccess`).
const AUTO_SS_KEY = "batchchef:auto-draft-v1";

interface AutoDraft {
  numRecipes: number;
  portions: number;
  vegetarian: boolean;
  maxCost: number | null;
  maxPrep: number | null;
  healthMin: number | null;
  preferInventory: boolean;
  mealType: string;
  includedIngs: IngredientMaster[];
  excludedIngs: IngredientMaster[];
  preview: BatchPreview | null;
  excluded: number[];
}

function loadAutoDraft(): AutoDraft | null {
  try {
    const raw = sessionStorage.getItem(AUTO_SS_KEY);
    return raw ? (JSON.parse(raw) as AutoDraft) : null;
  } catch {
    return null;
  }
}

export function clearAutoBatchDraft() {
  try { sessionStorage.removeItem(AUTO_SS_KEY); } catch {}
}

export function AutoBatchPage() {
  const router = useRouter();

  // Filters — initialized with defaults for SSR parity. The sessionStorage
  // draft is applied in a post-mount useEffect so server-rendered HTML and
  // first client render match exactly (fixes Next.js hydration mismatch
  // that was reported on /batch: "Plats → Peu importe", "Générer pour moi
  // → Recommencer").
  const [numRecipes, setNumRecipes] = useState(3);
  const [portions, setPortions] = useState(16);
  const [vegetarian, setVegetarian] = useState(false);
  const [maxCost, setMaxCost] = useState<number | null>(null);
  const [maxPrep, setMaxPrep] = useState<number | null>(null);
  const [healthMin, setHealthMin] = useState<number | null>(null);
  const [preferInventory, setPreferInventory] = useState(true);
  const [mealType, setMealType] = useState<string>("");
  const [includedIngs, setIncludedIngs] = useState<IngredientMaster[]>([]);
  const [excludedIngs, setExcludedIngs] = useState<IngredientMaster[]>([]);
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [excluded, setExcluded] = useState<number[]>([]);
  // Recipe IDs the user has pinned — reroll preserves these and only
  // replaces the others. Cleared on accept or on a full "Recommencer".
  const [kept, setKept] = useState<Set<number>>(new Set());
  // Tracks whether we've done the initial hydration — we skip the persist
  // effect until it's true so the defaults don't clobber a saved draft.
  const [hydrated, setHydrated] = useState(false);

  // One-shot hydration from sessionStorage after the first client render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    const d = loadAutoDraft();
    if (d) {
      setNumRecipes(d.numRecipes);
      setPortions(d.portions);
      setVegetarian(d.vegetarian);
      setMaxCost(d.maxCost);
      setMaxPrep(d.maxPrep);
      setHealthMin(d.healthMin);
      setPreferInventory(d.preferInventory);
      setMealType(d.mealType);
      setIncludedIngs(d.includedIngs);
      setExcludedIngs(d.excludedIngs);
      setPreview(d.preview);
      setExcluded(d.excluded);
    }
    setHydrated(true);
  }, []);

  // Persist every change. Skipped until we've hydrated so we don't
  // overwrite the stored draft with default values on mount.
  useEffect(() => {
    if (!hydrated) return;
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(
        AUTO_SS_KEY,
        JSON.stringify({
          numRecipes, portions, vegetarian, maxCost, maxPrep, healthMin,
          preferInventory, mealType, includedIngs, excludedIngs,
          preview, excluded,
        } satisfies AutoDraft),
      );
    } catch {
      // quota / private browsing — silent
    }
  }, [
    hydrated,
    numRecipes, portions, vegetarian, maxCost, maxPrep, healthMin,
    preferInventory, mealType, includedIngs, excludedIngs, preview, excluded,
  ]);

  const generate = useMutation({
    mutationFn: async (): Promise<BatchPreview> => {
      const keptIds = Array.from(kept);
      const res = await batchesApi.preview({
        target_portions: portions,
        num_recipes: numRecipes,
        vegetarian_only: vegetarian,
        max_cost_per_portion: maxCost ?? undefined,
        prep_time_max_min: maxPrep ?? undefined,
        health_score_min: healthMin ?? undefined,
        exclude_recipe_ids: excluded,
        // Pin the kept recipes so the backend's slot picker preserves them
        // and only rerolls the empty slots.
        include_recipe_ids: keptIds.length ? keptIds : undefined,
        prefer_inventory: preferInventory,
        meal_type_sequence: mealType ? new Array(numRecipes).fill(mealType) : undefined,
        include_ingredient_ids: includedIngs.length ? includedIngs.map((i) => i.id) : undefined,
        exclude_ingredient_ids: excludedIngs.length ? excludedIngs.map((i) => i.id) : undefined,
      });
      return res.data;
    },
    onSuccess: (data) => {
      setPreview(data);
      // Trim ``kept`` to IDs that actually landed in the new preview (in
      // case the backend dropped one that no longer fits the constraints).
      setKept((prev) => {
        const stillThere = new Set(data.recipes.map((r) => r.id));
        const next = new Set<number>();
        for (const id of prev) if (stillThere.has(id)) next.add(id);
        return next;
      });
    },
  });

  const regen = () => {
    // Reroll: push ONLY the non-kept recipes into the exclude list so the
    // backend doesn't propose them again. Kept ones remain in
    // include_recipe_ids and get preserved slot-for-slot.
    if (preview) {
      const toExclude = preview.recipes
        .filter((r) => !kept.has(r.id))
        .map((r) => r.id);
      if (toExclude.length) {
        setExcluded((prev) => [...prev, ...toExclude]);
      }
    }
    setPreview(null);
    setTimeout(() => generate.mutate(), 0);
  };

  const toggleKept = (id: number) => {
    setKept((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetAll = () => {
    // "Recommencer": wipe everything including the kept set and
    // accumulated exclusions, so the next generation starts fresh.
    setKept(new Set());
    setExcluded([]);
    setPreview(null);
    setTimeout(() => generate.mutate(), 0);
  };

  const accept = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("Pas de batch à accepter");
      const res = await batchesApi.generate({
        target_portions: portions,
        num_recipes: preview.recipes.length,
        include_recipe_ids: preview.recipes.map((r) => r.id),
        prefer_inventory: false, // we already picked the recipes
      });
      return res.data;
    },
    onSuccess: (batch) => {
      // Batch is persisted — wipe the draft so a fresh /batch visit starts
      // clean (otherwise we'd restore a preview on top of an already-saved
      // batch, confusing the user).
      clearAutoBatchDraft();
      router.push(`/batches/${batch.id}`);
    },
  });

  const itemsByStore: Record<string, ShoppingItemPreview[]> = {};
  for (const it of preview?.shopping_items ?? []) {
    const code = it.store?.code ?? "autre";
    (itemsByStore[code] ??= []).push(it);
  }

  return (
    <div className="space-y-5">
      {/* ===== Filters ===== */}
      <section className="rounded-2xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="title-serif text-lg font-semibold">Préférences</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumberField
            label="Nombre de recettes"
            value={numRecipes}
            onChange={setNumRecipes}
            min={2}
            max={5}
            step={1}
          />
          <NumberField
            label="Portions totales"
            value={portions}
            onChange={setPortions}
            min={4}
            max={40}
            step={2}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FilterPill
            label="Max $/portion"
            value={maxCost}
            onChange={setMaxCost}
            unit="$"
            placeholder="pas de max"
          />
          <FilterPill
            label="Prep max"
            value={maxPrep}
            onChange={setMaxPrep}
            unit="min"
            placeholder="pas de max"
          />
          <FilterPill
            label="Santé min"
            value={healthMin}
            onChange={setHealthMin}
            unit="/10"
            placeholder="0"
            step={0.5}
          />
        </div>

        <div className="flex flex-wrap gap-3 pt-1">
          <Toggle
            checked={vegetarian}
            onChange={setVegetarian}
            icon={Leaf}
            label="Végétarien uniquement"
          />
          <Toggle
            checked={preferInventory}
            onChange={setPreferInventory}
            icon={Snowflake}
            label="Utiliser mon frigo en priorité"
          />
        </div>

        {/* Meal type */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground font-medium">
            <Utensils className="h-3.5 w-3.5" />
            Type
          </span>
          {[
            { v: "", label: "Peu importe" },
            { v: "entree", label: "Entrées" },
            { v: "plat", label: "Plats" },
            { v: "dessert", label: "Desserts" },
            { v: "snack", label: "Snacks" },
          ].map(({ v, label }) => (
            <button
              key={v || "any"}
              onClick={() => setMealType(v)}
              className={`inline-flex items-center rounded-full border px-3 h-7 text-xs font-medium transition-colors ${
                mealType === v
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border text-muted-foreground hover:bg-accent/60"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Ingredient constraints */}
        <div className="space-y-2 pt-1 border-t border-border">
          <p className="text-[11px] text-muted-foreground">
            Contraintes d&apos;ingrédients — la recette doit contenir <strong>tous</strong> les
            inclus et <strong>aucun</strong> des exclus.
          </p>
          <IngredientChipPicker
            label="Inclure"
            tone="include"
            selected={includedIngs}
            onAdd={(ing) =>
              setIncludedIngs((prev) =>
                prev.some((x) => x.id === ing.id) ? prev : [...prev, ing],
              )
            }
            onRemove={(id) => setIncludedIngs((prev) => prev.filter((x) => x.id !== id))}
          />
          <IngredientChipPicker
            label="Exclure"
            tone="exclude"
            selected={excludedIngs}
            onAdd={(ing) =>
              setExcludedIngs((prev) =>
                prev.some((x) => x.id === ing.id) ? prev : [...prev, ing],
              )
            }
            onRemove={(id) => setExcludedIngs((prev) => prev.filter((x) => x.id !== id))}
          />
          <AllergyFilter
            excluded={excludedIngs}
            onMergeExclude={(ings) =>
              setExcludedIngs((prev) => {
                const seen = new Set(prev.map((x) => x.id));
                return [...prev, ...ings.filter((i) => !seen.has(i.id))];
              })
            }
            onRemoveExclude={(id) =>
              setExcludedIngs((prev) => prev.filter((x) => x.id !== id))
            }
          />
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <button
            onClick={() => {
              // Fresh start: wipe both exclusions AND kept pins so the
              // next generation is unconstrained.
              if (preview) resetAll();
              else {
                setExcluded([]);
                generate.mutate();
              }
            }}
            disabled={generate.isPending}
            className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 h-10 text-sm font-semibold shadow-sm hover:bg-primary/90 hover:shadow-md disabled:opacity-50 transition-all"
          >
            {generate.isPending ? (
              <Sparkles className="h-4 w-4 animate-pulse" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {preview ? "Recommencer" : "Générer pour moi"}
          </button>
          {preview && (
            <button
              onClick={regen}
              disabled={generate.isPending}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 h-10 text-sm font-medium hover:bg-accent/60 disabled:opacity-50"
              title={
                kept.size > 0
                  ? `Reroll des ${preview.recipes.length - kept.size} non épinglées (${kept.size} gardée${kept.size > 1 ? "s" : ""})`
                  : "Autre suggestion"
              }
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {kept.size > 0
                ? `Reroll les autres (${preview.recipes.length - kept.size})`
                : "Autre suggestion"}
            </button>
          )}
        </div>

        {generate.isError && (
          <div className="rounded-md bg-destructive/10 text-destructive text-xs p-2">
            Impossible de générer : {(generate.error as Error).message}
          </div>
        )}
      </section>

      {/* ===== Empty state ===== */}
      {!preview && !generate.isPending && (
        <div className="rounded-3xl border-2 border-dashed p-10 text-center space-y-3 bg-card/50">
          <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 inline-flex items-center justify-center">
            <ChefHat className="h-7 w-7 text-primary" />
          </div>
          <p className="title-serif text-lg font-semibold">Pas encore de suggestion</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Règle tes préférences ci-dessus puis clique <strong>Générer pour moi</strong>.
            Je te proposerai un batch complet avec la liste de courses.
          </p>
        </div>
      )}

      {/* ===== Preview ===== */}
      {preview && (
        <>
          {/* Stats row */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatBox
              label="Recettes"
              value={preview.recipes.length.toString()}
              sub={`${preview.total_portions} portions`}
            />
            <StatBox
              label="Coût total"
              value={formatPrice(preview.total_estimated_cost)}
              sub={
                preview.total_portions > 0
                  ? `${formatPrice(preview.total_estimated_cost / preview.total_portions)}/portion`
                  : ""
              }
            />
            <StatBox
              label="Couverture"
              value={`${Math.round(preview.price_coverage * 100)}%`}
              sub={`${preview.shopping_items.length} articles`}
              tone={preview.price_coverage < 0.9 ? "warn" : "ok"}
            />
            <StatBox
              label="Ingrédients"
              value={preview.shopping_items.filter((it) => it.from_inventory_qty > 0).length.toString()}
              sub="déjà dans ton frigo"
              tone="secondary"
            />
          </section>

          {/* Recipe proposals */}
          <section>
            <div className="flex items-end justify-between mb-3">
              <h2 className="title-serif text-xl font-bold">Recettes proposées</h2>
              {kept.size > 0 && (
                <p className="text-xs text-muted-foreground">
                  📌 {kept.size} épinglée{kept.size > 1 ? "s" : ""} · seront préservées au reroll
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {preview.recipes.map((r) => {
                const isKept = kept.has(r.id);
                return (
                  <div
                    key={r.id}
                    className={`relative rounded-2xl border bg-card overflow-hidden transition-all ${
                      isKept
                        ? "border-primary shadow-md ring-2 ring-primary/30"
                        : "hover:shadow-md"
                    }`}
                  >
                    {/* Pin toggle — stops propagation so it doesn't fire the recipe link */}
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleKept(r.id);
                      }}
                      className={`absolute top-2 left-2 z-10 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold shadow transition-all ${
                        isKept
                          ? "bg-primary text-primary-foreground scale-100"
                          : "bg-background/90 backdrop-blur text-muted-foreground hover:bg-primary hover:text-primary-foreground scale-90 hover:scale-100"
                      }`}
                      title={isKept ? "Cliquer pour ne plus garder" : "Garder cette recette au prochain reroll"}
                    >
                      {isKept ? "📌 Gardée" : "📌 Garder"}
                    </button>
                    <Link
                      href={`/recipes/${r.id}`}
                      className="group block"
                    >
                      <div className="relative aspect-[16/10] overflow-hidden bg-muted">
                        {r.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.image_url}
                            alt={r.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-4xl">🍽️</div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/60 to-transparent" />
                        {r.health_score != null && (
                          <span className="absolute top-2 right-2 inline-flex items-center gap-0.5 rounded-full bg-background/90 backdrop-blur px-1.5 py-0.5 text-[10px] font-bold shadow">
                            <Star className={`h-2.5 w-2.5 ${healthColor(r.health_score)}`} />
                            <span className={healthColor(r.health_score)}>{r.health_score.toFixed(1)}</span>
                          </span>
                        )}
                        <span className="absolute bottom-2 left-2 rounded-full bg-secondary/95 text-secondary-foreground text-[10px] font-bold px-2 py-0.5 shadow">
                          {r.portions} portions
                        </span>
                      </div>
                      <div className="p-3">
                        <p className="title-serif font-semibold text-sm line-clamp-2">{r.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {r.meal_type ? mealTypeLabel(r.meal_type) : "—"}
                          {r.estimated_cost_per_portion != null && (
                            <> · {formatPrice(r.estimated_cost_per_portion)}/portion</>
                          )}
                        </p>
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Missing prices banner */}
          {preview.unpriced_ingredients.length > 0 && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              <p className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5 mb-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                {preview.unpriced_ingredients.length} ingrédient
                {preview.unpriced_ingredients.length > 1 ? "s" : ""} sans prix
              </p>
              <p className="text-muted-foreground">
                {preview.unpriced_ingredients.slice(0, 10).join(", ")}
                {preview.unpriced_ingredients.length > 10 ? "…" : ""}
              </p>
            </div>
          )}

          {/* Shopping list */}
          <section>
            <h2 className="title-serif text-xl font-bold mb-3 flex items-center gap-2">
              <Package className="h-5 w-5" />
              Liste de courses
            </h2>
            <div className="space-y-3">
              {Object.entries(itemsByStore).map(([storeCode, storeItems]) => (
                <div key={storeCode} className="rounded-2xl border bg-card overflow-hidden">
                  <header className="px-4 py-2.5 bg-muted/60 border-b border-border flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider">
                      {storeItems[0]?.store?.name ?? storeCode}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {storeItems.length} article{storeItems.length > 1 ? "s" : ""}
                    </span>
                  </header>
                  <ul className="divide-y divide-border">
                    {storeItems.map((it, idx) => (
                      <ShoppingRow
                        key={`${it.ingredient_master_id}-${it.unit}-${idx}`}
                        item={it}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {/* Accept CTA */}
          <div className="sticky bottom-20 md:bottom-6 z-10 flex items-center gap-2 rounded-full bg-card border shadow-lg p-1.5 pl-5 max-w-md mx-auto">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Total
              </p>
              <p className="title-serif font-bold text-lg leading-none">
                {formatPrice(preview.total_estimated_cost)}
              </p>
            </div>
            <button
              onClick={() => accept.mutate()}
              disabled={accept.isPending}
              className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 h-10 text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
            >
              {accept.isPending ? (
                <Sparkles className="h-4 w-4 animate-pulse" />
              ) : (
                <ChefHat className="h-4 w-4" />
              )}
              {accept.isPending ? "Création…" : "Accepter ce batch"}
            </button>
          </div>
          {accept.isError && (
            <div className="text-xs text-destructive text-center">
              Échec : {(accept.error as Error).message}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------- Small helpers ----------

function NumberField({
  label, value, onChange, min, max, step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium">{label}</label>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(Math.max(min, value - step))}
          className="h-8 w-8 rounded-md border hover:bg-accent inline-flex items-center justify-center"
          aria-label="moins"
        >
          <Minus className="h-3 w-3" />
        </button>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(+e.target.value)}
          className="flex-1 accent-primary"
        />
        <button
          onClick={() => onChange(Math.min(max, value + step))}
          className="h-8 w-8 rounded-md border hover:bg-accent inline-flex items-center justify-center"
          aria-label="plus"
        >
          <Plus className="h-3 w-3" />
        </button>
        <span className="title-serif font-bold w-10 text-center">{value}</span>
      </div>
    </div>
  );
}

function FilterPill({
  label, value, onChange, unit, placeholder, step = 0.5,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  unit: string;
  placeholder: string;
  step?: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium">{label}</span>
      <div className="flex items-center gap-1 rounded-md border bg-background px-2 h-9">
        <input
          type="number"
          step={step}
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? null : +v);
          }}
          className="flex-1 bg-transparent outline-none text-sm"
        />
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
    </label>
  );
}

function Toggle({
  checked, onChange, icon: Icon, label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-2 rounded-full border px-3 h-9 text-xs font-medium transition-colors ${
        checked
          ? "bg-secondary/15 border-secondary/40 text-secondary"
          : "bg-background border-border text-muted-foreground hover:border-secondary/30"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function StatBox({
  label, value, sub, tone = "default",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "secondary" | "warn" | "ok";
}) {
  const toneCls = {
    default: "",
    secondary: "text-secondary",
    warn: "text-amber-600",
    ok: "text-secondary",
  }[tone];
  return (
    <div className="rounded-2xl border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </p>
      <p className={`title-serif font-bold text-2xl leading-none mt-1 ${toneCls}`}>
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}

function ShoppingRow({ item }: { item: ShoppingItemPreview }) {
  const pkg = item.format_qty != null && item.format_unit
    ? `${item.packages_to_buy}× ${item.format_qty} ${item.format_unit}`
    : null;
  const fromInv = item.from_inventory_qty > 0;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/20">
      <div className="shrink-0 h-9 w-9 rounded-lg bg-muted/60 border inline-flex items-center justify-center">
        <Package className="h-4 w-4 text-muted-foreground/70" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm truncate">
            {item.ingredient?.display_name_fr ?? item.ingredient?.canonical_name ?? "?"}
          </span>
          {fromInv && (
            <span className="text-[10px] text-secondary font-medium" title="Déduit de ton inventaire">
              (frigo)
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">
          Besoin {item.quantity_needed.toLocaleString("fr-CA", { maximumFractionDigits: 2 })} {item.unit}
          {pkg && <span> · {pkg}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {item.product_url && (
          <a
            href={item.product_url}
            target="_blank"
            rel="noopener noreferrer"
            className="h-7 w-7 rounded-md hover:bg-accent inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {item.estimated_cost != null ? (
          <span className="font-bold font-serif text-sm min-w-[60px] text-right">
            {formatPrice(item.estimated_cost)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground min-w-[60px] text-right">—</span>
        )}
      </div>
    </li>
  );
}
