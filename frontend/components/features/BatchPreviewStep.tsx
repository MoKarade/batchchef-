"use client";

import { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, Eye, ExternalLink, Loader2, ShoppingCart, Users } from "lucide-react";
import { batchesApi, type BatchPreview } from "@/lib/api";
import { formatPrice, healthColor, mealTypeLabel, categoryEmoji } from "@/lib/utils";
import { RecipeModal } from "./RecipeModal";

interface Props {
  preview: BatchPreview;
  onBack: () => void;
}

export function BatchPreviewStep({ preview, onBack }: Props) {
  const [openRecipeId, setOpenRecipeId] = useState<number | null>(null);
  const router = useRouter();
  const qc = useQueryClient();

  const itemsByStore = useMemo(() => {
    const groups: Record<string, typeof preview.shopping_items> = {};
    for (const it of preview.shopping_items) {
      const k = it.store?.name ?? "Sans magasin";
      groups[k] ??= [];
      groups[k].push(it);
    }
    return groups;
  }, [preview.shopping_items]);

  const hasMissingPrices = (preview.price_coverage ?? 1) < 1.0;

  const acceptMut = useMutation({
    mutationFn: () =>
      batchesApi.accept({
        target_portions: preview.target_portions,
        recipes: preview.recipes.map((r) => ({ recipe_id: r.id, portions: r.portions })),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["batches"] });
      router.push(`/batches/${res.data.id}`);
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Modifier la configuration
        </button>
      </div>

      <div className="rounded-xl border bg-card p-4 grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Portions</p>
          <p className="text-xl font-bold flex items-center gap-1">
            <Users className="h-4 w-4" /> {preview.total_portions}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Recettes</p>
          <p className="text-xl font-bold">{preview.recipes.length}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Coût estimé</p>
          <p className="text-xl font-bold">{formatPrice(preview.total_estimated_cost)}</p>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Recettes proposées
        </h2>
        <ul className="grid md:grid-cols-3 gap-3">
          {preview.recipes.map((r) => (
            <li key={r.id} className="rounded-xl border bg-card overflow-hidden">
              {r.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.image_url} alt={r.title} className="w-full h-32 object-cover" />
              ) : (
                <div className="w-full h-32 bg-muted flex items-center justify-center text-3xl">🍽️</div>
              )}
              <div className="p-3 space-y-2">
                <p className="text-sm font-medium line-clamp-2 leading-tight">{r.title}</p>
                <div className="flex items-center gap-1.5 flex-wrap text-xs">
                  {r.meal_type && (
                    <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5">
                      {mealTypeLabel(r.meal_type)}
                    </span>
                  )}
                  {r.health_score != null && (
                    <span className={healthColor(r.health_score)}>★ {r.health_score.toFixed(1)}</span>
                  )}
                  <span className="text-muted-foreground">· {r.portions} portions</span>
                </div>
                <button
                  onClick={() => setOpenRecipeId(r.id)}
                  className="w-full text-xs h-7 rounded-md border hover:bg-accent inline-flex items-center justify-center gap-1"
                >
                  <Eye className="h-3 w-3" /> Aperçu
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <ShoppingCart className="h-4 w-4" /> Liste de courses prévue
        </h2>
        {preview.shopping_items.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-xl border bg-card p-4">
            Aucun ingrédient à acheter (tout est en stock).
          </p>
        ) : (
          Object.entries(itemsByStore).map(([store, items]) => (
            <div key={store} className="rounded-xl border bg-card">
              <div className="p-3 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {store}
              </div>
              <ul className="divide-y">
                {items.map((it, i) => (
                  <li key={i} className="p-3 flex items-center gap-3 text-sm">
                    <span className="text-xl">{categoryEmoji(undefined)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {it.ingredient?.display_name_fr ?? `#${it.ingredient_master_id}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Besoin {it.quantity_needed} {it.unit}
                        {it.from_inventory_qty > 0 && ` · ${it.from_inventory_qty} déjà en stock`}
                        {it.format_qty && ` · ${it.packages_to_buy}× ${it.format_qty} ${it.format_unit ?? it.unit}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {it.product_url && (
                        <a
                          href={it.product_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-primary"
                          title="Voir le produit"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <span className="text-sm font-semibold tabular-nums">
                        {formatPrice(it.estimated_cost)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      {hasMissingPrices && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 space-y-1">
          <p className="text-sm font-semibold text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Prix manquants ({Math.round((preview.price_coverage ?? 0) * 100)}% couverture)
          </p>
          <p className="text-xs text-destructive/80">
            Ces ingrédients n&apos;ont pas de correspondance Maxi/Costco — le batch ne peut pas être accepté :
          </p>
          <ul className="text-xs text-destructive/90 list-disc list-inside">
            {(preview.unpriced_ingredients ?? []).map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      )}

      {acceptMut.isError && (
        <div className="text-sm text-destructive space-y-1">
          {(() => {
            const detail = (acceptMut.error as { response?: { data?: { detail?: { message?: string; unpriced_ingredients?: string[] } | string } } })?.response?.data?.detail;
            if (detail && typeof detail === "object" && detail.unpriced_ingredients) {
              return (
                <>
                  <p className="font-semibold">{detail.message}</p>
                  <ul className="list-disc list-inside text-xs">
                    {detail.unpriced_ingredients.map((n) => <li key={n}>{n}</li>)}
                  </ul>
                </>
              );
            }
            return <p>{typeof detail === "string" ? detail : "Erreur lors de la création du batch."}</p>;
          })()}
        </div>
      )}

      <div className="flex gap-3 sticky bottom-4">
        <button
          onClick={onBack}
          className="flex-1 h-11 rounded-md border bg-background text-sm font-medium hover:bg-accent"
        >
          ← Modifier
        </button>
        <button
          onClick={() => acceptMut.mutate()}
          disabled={acceptMut.isPending || hasMissingPrices}
          className="flex-[2] h-11 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {acceptMut.isPending ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Création…</>
          ) : (
            <><Check className="h-4 w-4" /> Accepter et créer le batch</>
          )}
        </button>
      </div>

      <RecipeModal
        recipeId={openRecipeId}
        portions={preview.recipes.find((r) => r.id === openRecipeId)?.portions ?? 1}
        onClose={() => setOpenRecipeId(null)}
      />
    </div>
  );
}
