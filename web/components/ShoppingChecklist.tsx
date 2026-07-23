"use client";

// Liste cochable, optimiste : le trait apparaît immédiatement, l'écriture part en
// arrière-plan ; si elle échoue (réseau d'épicerie…), la case REVIENT et un bandeau
// le dit — jamais un état local qui ment sur ce qui est sauvegardé.

import { useMemo, useState } from "react";
import { toggleShoppingItem } from "@/lib/actions";
import { formatQty } from "@/lib/aggregate";

interface Item {
  id: number;
  name: string;
  qty: number | null;
  unit: "g" | "ml" | "unite" | null;
  estCost: number | null;
  costKind: "estime" | "confirme" | null;
  checked: boolean;
}

export function ShoppingChecklist({ items: initial }: { items: Item[] }) {
  const [items, setItems] = useState(initial);
  const [syncError, setSyncError] = useState(false);

  const remaining = useMemo(() => items.filter((i) => !i.checked), [items]);
  const done = useMemo(() => items.filter((i) => i.checked), [items]);
  const restant = remaining.reduce((sum, i) => sum + (i.estCost ?? 0), 0);

  const toggle = (item: Item) => {
    const next = !item.checked;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: next } : i)));
    void toggleShoppingItem(item.id, next).then((res) => {
      if (!res.ok) {
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: !next } : i)));
        setSyncError(true);
      } else {
        setSyncError(false);
      }
    });
  };

  const Row = ({ item }: { item: Item }) => (
    <li>
      <button
        type="button"
        onClick={() => toggle(item)}
        className="flex w-full items-center gap-3 px-4 py-4 text-left active:bg-stone-100 dark:active:bg-stone-800"
      >
        <span
          aria-hidden
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 text-white ${
            item.checked ? "border-orange-700 bg-orange-700" : "border-stone-300 dark:border-stone-600"
          }`}
        >
          {item.checked ? "✓" : ""}
        </span>
        <span className={`min-w-0 flex-1 ${item.checked ? "text-stone-400 line-through" : ""}`}>
          {item.name}
          <span className="ml-2 text-sm text-stone-500 tabular-nums">
            {formatQty(item.qty, item.unit)}
          </span>
        </span>
        {item.estCost !== null && (
          <span className="shrink-0 text-sm tabular-nums text-stone-500">
            {item.estCost.toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
            {item.costKind === "estime" && <span title="Prix estimé"> ≈</span>}
          </span>
        )}
      </button>
    </li>
  );

  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500 dark:border-stone-700">
        Liste vide.
      </p>
    );
  }

  return (
    <div className="space-y-4 pb-16">
      {syncError && (
        <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Échec de sauvegarde (réseau ?) — la case a été remise. Réessaie.
        </p>
      )}
      <div className="sticky top-14 z-10 flex items-center justify-between rounded-xl bg-stone-100 px-4 py-2 text-sm dark:bg-stone-900">
        <span>
          {done.length}/{items.length} pris
        </span>
        <span className="tabular-nums">
          Restant ≈ {restant.toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
          <span className="ml-1 text-xs text-stone-500">(estimé)</span>
        </span>
      </div>
      <ul className="divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white text-base dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
        {remaining.map((item) => (
          <Row key={item.id} item={item} />
        ))}
      </ul>
      {done.length > 0 && (
        <>
          <h2 className="pt-2 text-sm font-medium text-stone-500">Dans le panier</h2>
          <ul className="divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white text-base dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
            {done.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
