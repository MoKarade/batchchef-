"use client";

// Avancement du batch : stepper tactile (planifié → courses → cuisine → terminé).
// Chaque étape est une grosse cible : toucher « Terminé » clôt le batch. Suppression à part.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteBatch, setBatchStatus } from "@/lib/actions/batch";

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
    <div className="space-y-4">
      <div>
        <h2 className="mb-3 text-xl font-bold">Avancement</h2>
        {/* L'étape « en cours » est en ARGENT (contour `--accent`), pas en `--repere` : le
            repère n'est jamais un état. Fait / en cours se DISENT aussi en texte masqué,
            jamais par la couleur seule. */}
        <ol className="etapes" aria-label="Avancement du batch">
          {STATUSES.map((s, i) => {
            const done = i < currentIndex;
            const active = i === currentIndex;
            return (
              <li key={s.value}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => go(s.value)}
                  aria-current={active ? "step" : undefined}
                  data-fait={done ? "oui" : "non"}
                  className="etape disabled:opacity-60"
                >
                  <span className="etape-st">Étape {i + 1}</span>
                  {s.label}
                  {(done || active) && (
                    <span className="sr-only">{done ? " (faite)" : " (en cours)"}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Action principale : avancer d'une étape (dont « Terminer le batch » depuis Cuisine). */}
      {next && (
        <button
          type="button"
          disabled={pending}
          onClick={() => go(next.value)}
          className="bouton bouton-principal w-full"
        >
          {next.value === "termine" ? "Terminer le batch" : `Passer à « ${next.label} »`}
        </button>
      )}
      {current === "termine" && (
        <p className="bandeau succes" role="status">
          Batch terminé.
        </p>
      )}

      {error && (
        <p className="bandeau erreur" role="alert">
          {error}
        </p>
      )}

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
        className="bouton bouton-second w-full"
      >
        Supprimer le batch
      </button>
    </div>
  );
}
