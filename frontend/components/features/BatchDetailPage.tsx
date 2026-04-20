"use client";

import { useQuery } from "@tanstack/react-query";
import { batchesApi } from "@/lib/api";
import { formatPrice } from "@/lib/utils";
import { ArrowLeft, ChefHat, ShoppingCart, Users } from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export function BatchDetailPage({ batchId }: { batchId: number }) {
  const { data: batch, isLoading } = useQuery({
    queryKey: ["batch", batchId],
    queryFn: () => batchesApi.get(batchId).then((r) => r.data),
  });

  if (isLoading) {
    return <div className="max-w-2xl h-40 rounded-xl border animate-pulse" />;
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
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ChefHat className="h-6 w-6 text-primary" />
              {batch.name ?? `Batch #${batch.id}`}
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {format(new Date(batch.generated_at), "d MMMM yyyy", { locale: fr })}
            </p>
          </div>
          <Link href={`/shopping/${batch.id}`}>
            <button className="flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 h-9 text-sm font-medium hover:bg-primary/90">
              <ShoppingCart className="h-4 w-4" /> Liste de courses
            </button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Portions</p>
          <p className="text-xl font-bold flex items-center gap-1">
            <Users className="h-4 w-4" />
            {batch.total_portions ?? batch.target_portions}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Recettes</p>
          <p className="text-xl font-bold">{batch.batch_recipes.length}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Coût estimé</p>
          <p className="text-xl font-bold">{formatPrice(batch.total_estimated_cost)}</p>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Recettes</h2>
        <ul className="space-y-2">
          {batch.batch_recipes.map((br) => (
            <li key={br.id} className="rounded-lg border bg-card p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{br.recipe?.title ?? `Recette #${br.recipe_id}`}</p>
                <p className="text-xs text-muted-foreground">{br.portions} portions</p>
              </div>
              <Link href={`/recipes/${br.recipe_id}`}>
                <button className="text-xs px-3 h-7 rounded-md border hover:bg-accent">Voir</button>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
