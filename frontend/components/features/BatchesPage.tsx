"use client";

import { useQuery } from "@tanstack/react-query";
import { batchesApi, type Batch } from "@/lib/api";
import { formatPrice } from "@/lib/utils";
import { ChefHat, Clock, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

function BatchCard({ batch }: { batch: Batch }) {
  const statusColors: Record<string, string> = {
    draft: "bg-yellow-100 text-yellow-800",
    shopping: "bg-blue-100 text-blue-800",
    cooking: "bg-orange-100 text-orange-800",
    done: "bg-green-100 text-green-800",
  };
  const statusLabels: Record<string, string> = {
    draft: "Brouillon", shopping: "Shopping", cooking: "En cuisine", done: "Terminé",
  };

  return (
    <div className="rounded-xl border bg-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChefHat className="h-5 w-5 text-primary" />
          <span className="font-semibold">
            {batch.name ?? `Batch #${batch.id}`}
          </span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[batch.status] ?? ""}`}>
          {statusLabels[batch.status] ?? batch.status}
        </span>
      </div>

      <div className="flex gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          {format(new Date(batch.generated_at), "d MMM yyyy", { locale: fr })}
        </span>
        <span>{batch.total_portions ?? batch.target_portions} portions</span>
        {batch.total_estimated_cost != null && (
          <span>{formatPrice(batch.total_estimated_cost)}</span>
        )}
      </div>

      <div className="flex gap-2">
        <Link href={`/batches/${batch.id}`}>
          <button className="text-xs px-3 h-7 rounded-md border hover:bg-accent">Détails</button>
        </Link>
        <Link href={`/shopping/${batch.id}`}>
          <button className="flex items-center gap-1 text-xs px-3 h-7 rounded-md bg-primary text-primary-foreground hover:bg-primary/90">
            <ShoppingCart className="h-3 w-3" /> Liste de courses
          </button>
        </Link>
      </div>
    </div>
  );
}

export function BatchesListPage() {
  const { data: batches = [], isLoading } = useQuery({
    queryKey: ["batches"],
    queryFn: () => batchesApi.list().then((r) => r.data),
  });

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="title-serif text-3xl font-bold">Batch Cooking</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Vos sessions de meal prep</p>
        </div>
        <Link href="/batches/new">
          <button className="flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 h-9 text-sm font-medium hover:bg-primary/90">
            <ChefHat className="h-4 w-4" /> Nouveau batch
          </button>
        </Link>
      </div>

      {isLoading && <div className="space-y-3">{Array.from({length: 3}).map((_,i) => <div key={i} className="h-28 rounded-xl border animate-pulse" />)}</div>}
      {!isLoading && batches.length === 0 && (
        <p className="text-muted-foreground text-sm">Aucun batch créé. Importez des recettes d&apos;abord.</p>
      )}
      <div className="space-y-3">
        {batches.map((b) => <BatchCard key={b.id} batch={b} />)}
      </div>
    </div>
  );
}
