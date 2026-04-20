"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { batchesApi, type Batch } from "@/lib/api";
import { formatPrice } from "@/lib/utils";
import { ShoppingCart, CheckCircle2, Loader2 } from "lucide-react";

export default function ShoppingIndexPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["batches"],
    queryFn: () => batchesApi.list().then((r) => r.data),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const batches = (data ?? []).filter((b) => b.status !== "archived");

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShoppingCart className="h-6 w-6" /> Listes de courses
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sélectionne un batch pour voir sa liste de courses.
        </p>
      </div>

      {batches.length === 0 && (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          Aucun batch actif. <Link href="/batches/new" className="underline">Génère-en un</Link>.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {batches.map((b: Batch) => {
          const items = b.shopping_items ?? [];
          const purchased = items.filter((i) => i.is_purchased).length;
          const total = items.length;
          const pct = total > 0 ? Math.round((purchased / total) * 100) : 0;
          const done = total > 0 && purchased === total;
          return (
            <Link
              key={b.id}
              href={`/shopping/${b.id}`}
              className="block rounded-xl border bg-card p-5 hover:shadow-md transition"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-medium truncate">
                  {b.name ?? `Batch #${b.id}`}
                </h2>
                {done && <CheckCircle2 className="h-4 w-4 text-green-600" />}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(b.generated_at).toLocaleDateString("fr-CA")} · {b.target_portions} portions
              </p>
              <div className="mt-4 space-y-1">
                <div className="flex justify-between text-xs">
                  <span>{purchased}/{total} achetés</span>
                  <span>{pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-green-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              {b.total_estimated_cost != null && (
                <p className="mt-3 text-sm font-medium">
                  {formatPrice(b.total_estimated_cost)}
                </p>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
