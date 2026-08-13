"use client";

// Avancement du batch : stepper tactile (planifié → courses → cuisine → terminé).
// Chaque étape est une grosse cible : toucher « Terminé » clôt le batch. Suppression à part.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteBatch, setBatchStatus } from "@/lib/actions";

const STATUSES = [
  { value: "planifie", label: "Planifié" },
  { value: "courses", label: "Courses" },
  { value: "cuisine", label: "Cuisine" },
  { value: "termine", label: "Terminé" },
] as const;

type StatusValue = (typeof STATUSES)[number]["value"];

export function BatchStatusControls({
  batchId,
  status,
}: {
  batchId: number;
  status: string;
}) {
  const [current, setCurrent] = useState<string>(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const currentIndex = STATUSES.findIndex((s) => s.value === current);

  const go = (value: StatusValue) => {
    if (value === current) return;
    setError(null);
    setCurrent(value); // optimiste
    startTransition(async () => {
      const res = await setBatchStatus(batchId, value);
      if (!res.ok) {
        setError(res.error);
        setCurrent(status); // rollback
      }
    });
  };

  const next = STATUSES[currentIndex + 1];

  return (
    <div className="space-y-3">
      <div>
        <h2 className="mb-2 font-semibold">Avancement</h2>
        <div className="grid grid-cols-4 gap-1 rounded-xl border border-[var(--bordure)] p-1 ">
          {STATUSES.map((s, i) => {
            const done = i < currentIndex;
            const active = i === currentIndex;
            return (
              <button
                key={s.value}
                type="button"
                disabled={pending}
                onClick={() => go(s.value)}
                aria-current={active ? "step" : undefined}
                className={`rounded-lg px-2 py-2 text-xs font-medium transition disabled:opacity-60 ${
                  active
                    ? "text-white"
                    : done
                      ? "text-stone-700 dark:text-stone-300"
                      : "doux "
                }`}
                style={active ? { backgroundColor: "var(--accent)" } : undefined}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Action principale : avancer d'une étape (dont « Terminer le batch » depuis Cuisine). */}
      {next && (
        <button
          type="button"
          disabled={pending}
          onClick={() => go(next.value)}
          className="w-full rounded-xl border-2 px-4 py-3 text-sm font-medium disabled:opacity-60"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          {next.value === "termine" ? "Terminer le batch" : `Passer à « ${next.label} »`}
        </button>
      )}
      {current === "termine" && (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          Batch terminé.
        </p>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

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
        className="w-full rounded-xl border border-[var(--bordure)] px-4 py-2 text-sm doux disabled:opacity-60  "
      >
        Supprimer le batch
      </button>
    </div>
  );
}
