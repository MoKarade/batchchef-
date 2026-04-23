"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Sparkles, ChefHat, RefreshCw, Snowflake, AlertTriangle,
  Leaf, Star, Plus, Minus, Package, ExternalLink,
} from "lucide-react";
import { batchesApi, type BatchPreview, type ShoppingItemPreview } from "@/lib/api";
import { formatPrice, healthColor, mealTypeLabel } from "@/lib/utils";

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
export function AutoBatchPage() {
  const router = useRouter();

  // Filters
  const [numRecipes, setNumRecipes] = useState(3);
  const [portions, setPortions] = useState(16);
  const [vegetarian, setVegetarian] = useState(false);
  const [maxCost, setMaxCost] = useState<number | null>(null);
  const [maxPrep, setMaxPrep] = useState<number | null>(null);
  const [healthMin, setHealthMin] = useState<number | null>(null);
  const [preferInventory, setPreferInventory] = useState(true);

  // Current preview (what the backend proposes right now)
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [excluded, setExcluded] = useState<number[]>([]);

  const generate = useMutation({
    mutationFn: async (): Promise<BatchPreview> => {
      const res = await batchesApi.preview({
        target_portions: portions,
        num_recipes: numRecipes,
        vegetarian_only: vegetarian,
        max_cost_per_portion: maxCost ?? undefined,
        prep_time_max_min: maxPrep ?? undefined,
        health_score_min: healthMin ?? undefined,
        exclude_recipe_ids: excluded,
        prefer_inventory: preferInventory,
      });
      return res.data;
    },
    onSuccess: (data) => setPreview(data),
  });

  const regen = () => {
    // On re-roll, push the current recipes into the exclude list
    if (preview) {
      setExcluded((prev) => [...prev, ...preview.recipes.map((r) => r.id)]);
    }
    setPreview(null);
    // Schedule the next generate in the next tick so the exclude-state is live
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

        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <button
            onClick={() => {
              setExcluded([]);
              generate.mutate();
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
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Autre suggestion
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
            <h2 className="title-serif text-xl font-bold mb-3">Recettes proposées</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {preview.recipes.map((r) => (
                <Link
                  key={r.id}
                  href={`/recipes/${r.id}`}
                  className="group block rounded-2xl border bg-card overflow-hidden hover:shadow-md transition-all"
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
              ))}
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
                    {storeItems.map((it) => (
                      <ShoppingRow key={it.ingredient_master_id} item={it} />
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
