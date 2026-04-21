"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { inventoryApi } from "@/lib/api";
import { Trash2, Plus } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { AddInventoryItemModal } from "./AddInventoryItemModal";

export function InventoryPage() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["inventory"],
    queryFn: () => inventoryApi.list().then((r) => r.data),
    refetchInterval: 60_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => inventoryApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }),
  });

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventaire</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} articles en stock
          </p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 h-9 text-sm font-medium hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Ajouter un ingrédient
        </button>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Ingrédient</th>
              <th className="text-right px-4 py-3 font-medium">Quantité</th>
              <th className="text-left px-4 py-3 font-medium">Acheté le</th>
              <th className="text-left px-4 py-3 font-medium">Expire le</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">Chargement...</td></tr>
            )}
            {!isLoading && items.length === 0 && (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">Stock vide</td></tr>
            )}
            {items.map((item) => (
              <tr key={item.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 font-medium">
                  {item.ingredient?.display_name_fr ?? `Ingrédient #${item.ingredient_master_id}`}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {item.quantity} {item.unit}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {item.purchased_at ? format(new Date(item.purchased_at), "d MMM yyyy", { locale: fr }) : "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {item.expires_at ? format(new Date(item.expires_at), "d MMM yyyy", { locale: fr }) : "—"}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => deleteMut.mutate(item.id)}
                    className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AddInventoryItemModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
