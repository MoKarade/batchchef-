"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ShoppingBasket, X, Minus, Plus, Trash2, ChefHat, Sparkles,
  ArrowRight, Info, Package, ExternalLink, AlertTriangle,
} from "lucide-react";
import { useCart, removeFromCart, setPortions, clearCart } from "@/lib/cart";
import { batchesApi, type BatchPreview, type ShoppingItemPreview } from "@/lib/api";
import { formatPrice } from "@/lib/utils";

/**
 * "Panier" — draft batch in the making. User adds recipes via + buttons
 * on /recipes cards. Here they adjust portions, see total cost, and click
 * "Finaliser" to POST to /api/batches/generate with the final recipe_ids
 * and target_portions. On success, cart clears and we redirect to the
 * batch detail page.
 */
export function CartPage() {
  const router = useRouter();
  const { items, count, totalPortions, totalCost } = useCart();
  const [error, setError] = useState<string | null>(null);

  // Live preview — asks the backend to aggregate ingredients + look up Maxi
  // prices + deduct inventory, without persisting a real batch. Enabled
  // only when the cart has items, re-runs whenever items/portions change.
  const { data: preview, isLoading: previewLoading } = useQuery<BatchPreview>({
    queryKey: [
      "cart-preview",
      items.map((i) => `${i.recipe_id}:${i.portions}`).join(","),
    ],
    queryFn: () =>
      batchesApi
        .preview({
          target_portions: totalPortions,
          num_recipes: items.length,
          include_recipe_ids: items.map((i) => i.recipe_id),
        })
        .then((r) => r.data),
    enabled: items.length > 0,
    staleTime: 30_000,
  });

  const finalize = useMutation({
    mutationFn: async () => {
      // /api/batches/generate takes target_portions + an optional list of
      // preferred recipes. We send our cart recipe_ids and the sum of
      // portions as the target, so the generator respects the user's pick.
      const recipe_ids = items.map((i) => i.recipe_id);
      const res = await batchesApi.generate({
        target_portions: totalPortions,
        num_recipes: recipe_ids.length,
        include_recipe_ids: recipe_ids,
      });
      return res.data;
    },
    onSuccess: (batch) => {
      clearCart();
      router.push(`/batches/${batch.id}`);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: unknown } } })
        ?.response?.data?.detail;
      setError(
        typeof msg === "string"
          ? msg
          : typeof msg === "object" && msg && "message" in msg
          ? String((msg as { message: string }).message)
          : "Impossible de générer le batch — vérifie que tu as un worker Celery actif."
      );
    },
  });

  if (count === 0) {
    return (
      <div className="max-w-2xl">
        <header className="mb-6">
          <h1 className="title-serif text-3xl font-bold">Panier</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Compose ton batch de la semaine en ajoutant des recettes depuis le catalogue.
          </p>
        </header>
        <div className="rounded-3xl border-2 border-dashed border-border bg-card p-12 text-center space-y-4">
          <div className="mx-auto h-16 w-16 rounded-full bg-muted inline-flex items-center justify-center">
            <ShoppingBasket className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="title-serif text-lg font-semibold">Panier vide</p>
            <p className="text-sm text-muted-foreground mt-1">
              Ajoute des recettes depuis &laquo;&nbsp;Recettes&nbsp;&raquo; en cliquant sur le &plus;
            </p>
          </div>
          <Link
            href="/recipes"
            className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 h-10 text-sm font-semibold hover:bg-primary/90"
          >
            Explorer les recettes
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  // Group shopping items by store for display
  const itemsByStore: Record<string, ShoppingItemPreview[]> = {};
  for (const it of preview?.shopping_items ?? []) {
    const code = it.store?.code ?? "autre";
    (itemsByStore[code] ??= []).push(it);
  }

  // Preview may override our local cost estimate with the real computed
  // total (which accounts for packages_to_buy rounding + Maxi actual prices)
  const displayCost = preview?.total_estimated_cost ?? totalCost;
  const priceCoverage = preview?.price_coverage ?? 1.0;
  const unpriced = preview?.unpriced_ingredients ?? [];

  return (
    <div className="space-y-6 max-w-6xl">
      <header>
        <h1 className="title-serif text-3xl font-bold">Panier</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {count} recette{count > 1 ? "s" : ""} · {totalPortions} portion{totalPortions > 1 ? "s" : ""} totales
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* LEFT — Items */}
        <div className="space-y-3">
          {items.map((it) => (
            <article
              key={it.recipe_id}
              className="flex gap-3 p-3 rounded-2xl border bg-card hover:shadow-sm transition-shadow"
            >
              {/* Image */}
              <Link
                href={`/recipes/${it.recipe_id}`}
                className="shrink-0 w-20 h-20 md:w-24 md:h-24 rounded-xl overflow-hidden bg-muted"
              >
                {it.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.image_url} alt={it.title} className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl">🍽️</div>
                )}
              </Link>

              {/* Meta */}
              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <div>
                  <Link
                    href={`/recipes/${it.recipe_id}`}
                    className="title-serif font-semibold text-sm leading-tight line-clamp-2 hover:text-primary transition-colors"
                  >
                    {it.title}
                  </Link>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {it.cost_per_portion != null
                      ? `${formatPrice(it.cost_per_portion)}/portion`
                      : "Prix non disponible"}
                  </p>
                </div>

                {/* Portions control */}
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Portions
                  </span>
                  <div className="inline-flex items-center rounded-full border border-border overflow-hidden">
                    <button
                      onClick={() => setPortions(it.recipe_id, it.portions - 1)}
                      aria-label="Moins"
                      className="h-7 w-7 inline-flex items-center justify-center hover:bg-accent"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="px-3 text-sm font-semibold font-mono min-w-[2ch] text-center">
                      {it.portions}
                    </span>
                    <button
                      onClick={() => setPortions(it.recipe_id, it.portions + 1)}
                      aria-label="Plus"
                      className="h-7 w-7 inline-flex items-center justify-center hover:bg-accent"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                  {it.cost_per_portion != null && (
                    <span className="ml-auto text-sm font-bold font-serif text-secondary">
                      {formatPrice(it.cost_per_portion * it.portions)}
                    </span>
                  )}
                </div>
              </div>

              {/* Remove */}
              <button
                onClick={() => removeFromCart(it.recipe_id)}
                aria-label="Retirer du panier"
                className="self-start h-8 w-8 rounded-full hover:bg-destructive/10 hover:text-destructive text-muted-foreground inline-flex items-center justify-center transition-colors shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </article>
          ))}

          <button
            onClick={() => {
              if (confirm("Vider le panier ?")) clearCart();
            }}
            className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-destructive transition-colors mt-2"
          >
            <Trash2 className="h-3 w-3" />
            Vider le panier
          </button>

          {/* ===== INGREDIENTS PREVIEW — what you'll buy ===== */}
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="title-serif text-xl font-bold flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Liste de courses
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Après déduction de ton frigo · prix Maxi en temps réel
                </p>
              </div>
              {previewLoading && (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3 animate-pulse" /> Calcul…
                </span>
              )}
            </div>

            {unpriced.length > 0 && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <p className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {unpriced.length} ingrédient{unpriced.length > 1 ? "s" : ""} sans prix
                </p>
                <p className="text-muted-foreground">{unpriced.slice(0, 8).join(", ")}{unpriced.length > 8 ? "…" : ""}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Couverture&nbsp;: <span className="font-mono">{Math.round(priceCoverage * 100)}%</span>
                </p>
              </div>
            )}

            {preview && preview.shopping_items.length === 0 && !previewLoading && (
              <p className="text-sm text-muted-foreground italic">
                Aucun ingrédient à acheter — tout est déjà dans ton frigo.
              </p>
            )}

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
                    <ShoppingItemRow key={it.ingredient_master_id} item={it} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — Summary + CTA */}
        <aside className="space-y-4">
          <div className="sticky top-4 rounded-3xl border bg-card p-5 shadow-sm">
            <h2 className="title-serif text-lg font-bold mb-3">Récapitulatif</h2>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Recettes</span>
                <span className="font-semibold">{count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Portions totales</span>
                <span className="font-semibold">{totalPortions}</span>
              </div>
              <div className="h-px bg-border my-3" />
              <div className="flex justify-between items-baseline">
                <span className="text-muted-foreground">Coût total</span>
                {displayCost != null && displayCost > 0 ? (
                  <span className="title-serif text-2xl font-bold text-secondary">
                    {formatPrice(displayCost)}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground text-right">
                    {previewLoading ? "Calcul…" : "—"}
                  </span>
                )}
              </div>
              {preview && displayCost != null && displayCost > 0 && totalPortions > 0 && (
                <p className="text-[11px] text-muted-foreground text-right">
                  {formatPrice(displayCost / totalPortions)} / portion
                </p>
              )}
            </div>

            {error && (
              <div className="mt-3 rounded-md bg-destructive/10 text-destructive text-xs p-2">
                {error}
              </div>
            )}

            <button
              onClick={() => {
                setError(null);
                finalize.mutate();
              }}
              disabled={finalize.isPending}
              className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground h-11 text-sm font-semibold shadow-lg shadow-primary/20 hover:bg-primary/90 hover:shadow-xl disabled:opacity-50 transition-all"
            >
              {finalize.isPending ? (
                <>
                  <Sparkles className="h-4 w-4 animate-pulse" />
                  Génération…
                </>
              ) : (
                <>
                  <ChefHat className="h-4 w-4" />
                  Finaliser le batch
                </>
              )}
            </button>

            <p className="mt-3 flex items-start gap-2 text-[11px] text-muted-foreground leading-relaxed">
              <Info className="h-3 w-3 shrink-0 mt-0.5" />
              &laquo;&nbsp;Finaliser&nbsp;&raquo; agrège les ingrédients, déduit de ton frigo, et
              génère la liste de courses avec les prix Maxi.
            </p>
          </div>

          {/* Past batches link */}
          <Link
            href="/batches"
            className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Voir les batches passés &rarr;
          </Link>
        </aside>
      </div>
    </div>
  );
}

function ShoppingItemRow({ item }: { item: ShoppingItemPreview }) {
  const displayQty = item.quantity_needed;
  const unit = item.unit;
  const pkg = item.format_qty != null && item.format_unit
    ? `${item.packages_to_buy}× ${item.format_qty} ${item.format_unit}`
    : null;
  const fromInv = item.from_inventory_qty > 0;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/20 transition-colors">
      {/* Image / icon placeholder */}
      <div className="shrink-0 h-9 w-9 rounded-lg bg-muted/60 border inline-flex items-center justify-center">
        <Package className="h-4 w-4 text-muted-foreground/70" />
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm truncate">
            {item.ingredient?.display_name_fr ?? item.ingredient?.canonical_name ?? "?"}
          </span>
          {fromInv && (
            <span className="text-[10px] text-secondary font-medium" title="Déduit de ton inventaire">
              (frigo: {item.from_inventory_qty.toFixed(1)} {unit})
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">
          Besoin {displayQty.toLocaleString("fr-CA", { maximumFractionDigits: 2 })} {unit}
          {pkg && <span> · {pkg}</span>}
        </div>
      </div>

      {/* Price + link */}
      <div className="flex items-center gap-2 shrink-0">
        {item.product_url && (
          <a
            href={item.product_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="h-7 w-7 rounded-md hover:bg-accent inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
            title="Voir sur le site du magasin"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {item.estimated_cost != null ? (
          <span className="font-bold font-serif text-sm text-foreground min-w-[60px] text-right">
            {formatPrice(item.estimated_cost)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground min-w-[60px] text-right">—</span>
        )}
      </div>
    </li>
  );
}
