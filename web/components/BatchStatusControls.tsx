"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteBatch, setBatchStatus } from "@/lib/actions";

const STATUSES = [
  { value: "planifie", label: "Planifié" },
  { value: "courses", label: "Courses" },
  { value: "cuisine", label: "Cuisine" },
  { value: "termine", label: "Terminé" },
] as const;

export function BatchStatusControls({
  batchId,
  status,
}: {
  batchId: number;
  status: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex items-center gap-2">
      <select
        value={status}
        disabled={pending}
        onChange={(e) => {
          const value = e.target.value as (typeof STATUSES)[number]["value"];
          startTransition(async () => {
            const res = await setBatchStatus(batchId, value);
            if (!res.ok) setError(res.error);
          });
        }}
        className="rounded-xl border border-stone-300 bg-white px-3 py-3 text-sm dark:border-stone-700 dark:bg-stone-900"
      >
        {STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm("Supprimer ce batch et sa liste ?")) return;
          startTransition(async () => {
            const res = await deleteBatch(batchId);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            router.push("/batchs");
          });
        }}
        className="rounded-xl border border-stone-300 px-3 py-3 text-sm text-stone-600 dark:border-stone-700 dark:text-stone-400"
      >
        Suppr.
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
