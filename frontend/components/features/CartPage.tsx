"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  ShoppingBasket, X, Minus, Plus, Trash2, ChefHat, Sparkles,
  ArrowRight, Info,
} from "lucide-react";
import { useCart, removeFromCart, setPortions, clearCart } from "@/lib/cart";
import { batchesApi } from "@/lib/api";
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

  return (
    <div className="space-y-6 max-w-5xl">
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
                <span className="text-muted-foreground">Coût estimé</span>
                {totalCost != null ? (
                  <span className="title-serif text-2xl font-bold text-secondary">
                    {formatPrice(totalCost)}
                  </span>
                ) : (
                  <span className="text-xs text-amber-600 text-right">Certains prix manquent</span>
                )}
              </div>
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
