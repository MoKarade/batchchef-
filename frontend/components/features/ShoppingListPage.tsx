"use client";

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { batchesApi, type ShoppingItem } from "@/lib/api";
import { formatPrice } from "@/lib/utils";
import { ArrowLeft, ShoppingCart, Loader2, Package, Check } from "lucide-react";
import Link from "next/link";

function ShoppingRow({ batchId, item }: { batchId: number; item: ShoppingItem }) {
  const qc = useQueryClient();

  const mutate = useMutation({
    mutationFn: async (purchased: boolean) => {
      if (purchased) await batchesApi.purchaseItem(batchId, item.id);
      else await batchesApi.unpurchaseItem(batchId, item.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batch", batchId] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
    },
  });

  const name = item.ingredient?.display_name_fr ?? `Ingrédient #${item.ingredient_master_id}`;
  const packagesLabel = item.format_qty
    ? `${item.packages_to_buy} × ${item.format_qty}${item.format_unit ?? ""}`
    : `${item.packages_to_buy} ${item.unit}`;
  const surplus = item.format_qty && item.packages_to_buy
    ? item.packages_to_buy * item.format_qty - item.quantity_needed
    : 0;

  return (
    <li className={`flex items-center gap-3 rounded-lg border p-3 ${item.is_purchased ? "bg-green-50 border-green-200" : "bg-card"}`}>
      <button
        onClick={() => mutate.mutate(!item.is_purchased)}
        disabled={mutate.isPending}
        className={`shrink-0 h-6 w-6 rounded-md border flex items-center justify-center transition-colors ${
          item.is_purchased ? "bg-green-600 border-green-600 text-white" : "bg-background hover:border-primary"
        }`}
        aria-label={item.is_purchased ? "Marquer comme non acheté" : "Marquer comme acheté"}
      >
        {mutate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
         item.is_purchased ? <Check className="h-3.5 w-3.5" /> : null}
      </button>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${item.is_purchased ? "line-through text-muted-foreground" : ""}`}>
          {name}
        </p>
        <p className="text-xs text-muted-foreground">
          Besoin : {item.quantity_needed.toLocaleString()} {item.unit}
          {item.from_inventory_qty > 0 && (
            <span className="text-green-600"> — {item.from_inventory_qty} déjà en stock</span>
          )}
        </p>
      </div>

      <div className="text-right shrink-0">
        <p className="text-sm font-semibold">{packagesLabel}</p>
        {item.store && (
          <p className="text-xs text-muted-foreground">{item.store.name}</p>
        )}
        {item.estimated_cost != null && (
          <p className="text-xs text-muted-foreground">{formatPrice(item.estimated_cost)}</p>
        )}
        {surplus > 0 && item.format_unit && (
          <p className="text-[11px] text-blue-600 flex items-center gap-1 justify-end mt-0.5">
            <Package className="h-3 w-3" /> +{surplus.toLocaleString()}{item.format_unit} au stock
          </p>
        )}
      </div>
    </li>
  );
}

export function ShoppingListPage({ batchId }: { batchId: number }) {
  const { data: batch, isLoading } = useQuery({
    queryKey: ["batch", batchId],
    queryFn: () => batchesApi.get(batchId).then((r) => r.data),
  });

  const grouped = useMemo(() => {
    if (!batch) return new Map<string, ShoppingItem[]>();
    const map = new Map<string, ShoppingItem[]>();
    for (const it of batch.shopping_items) {
      const key = it.store?.name ?? "Autre";
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    return map;
  }, [batch]);

  const totalPurchased = batch?.shopping_items.filter((i) => i.is_purchased).length ?? 0;
  const total = batch?.shopping_items.length ?? 0;

  if (isLoading) {
    return <div className="max-w-2xl space-y-3">{Array.from({length: 4}).map((_,i) => <div key={i} className="h-14 rounded-lg border animate-pulse" />)}</div>;
  }
  if (!batch) {
    return <p className="text-sm text-muted-foreground">Batch introuvable.</p>;
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <Link href="/batches" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Retour
        </Link>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ShoppingCart className="h-6 w-6 text-primary" />
              {batch.name ?? `Batch #${batch.id}`}
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {totalPurchased}/{total} achetés
              {batch.total_estimated_cost != null && ` — Total estimé : ${formatPrice(batch.total_estimated_cost)}`}
            </p>
          </div>
        </div>
      </div>

      {total === 0 && <p className="text-sm text-muted-foreground">Aucun article à acheter — tout est en stock.</p>}

      {Array.from(grouped.entries()).map(([storeName, items]) => (
        <section key={storeName} className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{storeName}</h2>
          <ul className="space-y-2">
            {items.map((it) => <ShoppingRow key={it.id} batchId={batch.id} item={it} />)}
          </ul>
        </section>
      ))}

      <p className="text-xs text-muted-foreground italic">
        Cocher un article le marque comme acheté, déduit la quantité utilisée de l&apos;inventaire
        et ajoute le surplus (ex : 4,5 kg restants sur un sac de 5 kg) au stock.
      </p>
    </div>
  );
}
