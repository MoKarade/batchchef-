"use client";

// La carte « Ta semaine » (SEM-02) : quatre recettes du catalogue, remplaçables une à une,
// et un bouton qui monte le batch avec sa liste d'épicerie.
//
// ⚠️ Ce qui est AFFICHÉ ici est mesuré ou rien : les durées viennent du catalogue et
// `Durees` ne rend rien quand la source ne dit pas. Aucun « facile », aucun « végétarien » —
// le classement n'existe pas encore (SEM-01), et l'inventer serait exactement le contraire
// de ce que l'app promet.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Durees } from "@/components/Durees";
import { ImageRecette } from "@/components/ImageRecette";
import { creerBatchDepuisSemaine, remplacerRecetteSemaine } from "@/lib/actions";

export interface RecetteProposee {
  catalogRecipeId: number;
  titre: string;
  imageUrl: string | null;
  prepMinutes: number | null;
  cuissonMinutes: number | null;
  position: number;
}

export function SemaineProposee({
  recettes,
  panne,
}: {
  recettes: RecetteProposee[];
  /** Message de la panne qui a empêché de fabriquer la semaine, s'il y en a eu une. */
  panne?: string | null;
}) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [batchCree, setBatchCree] = useState<number | null>(null);
  const [enCours, setEnCours] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // ⚠️ Trois situations DISTINCTES, trois affichages : une panne se nomme, un catalogue
  // vide se dit, et quatre recettes s'affichent. Les confondre rendrait la panne invisible.
  if (panne) {
    return (
      <section className="carte space-y-2 p-4">
        <h2 className="text-lg font-semibold">Ta semaine</h2>
        <p className="text-sm texte-erreur">
          La proposition de la semaine n’a pas pu être préparée : {panne}
        </p>
      </section>
    );
  }
  if (recettes.length === 0) {
    return (
      <section className="carte space-y-2 p-4">
        <h2 className="text-lg font-semibold">Ta semaine</h2>
        <p className="text-sm doux">
          Aucune recette à proposer pour l’instant — le catalogue est vide.
        </p>
      </section>
    );
  }

  const remplacer = (position: number) =>
    startTransition(async () => {
      setErreur(null);
      setEnCours(position);
      const res = await remplacerRecetteSemaine(position);
      setEnCours(null);
      if (!res.ok) setErreur(res.error);
      else router.refresh();
    });

  const monterLeBatch = () =>
    startTransition(async () => {
      setErreur(null);
      const res = await creerBatchDepuisSemaine();
      if (!res.ok) setErreur(res.error);
      else setBatchCree(res.id ?? null);
    });

  return (
    <section className="carte space-y-3 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Ta semaine</h2>
        <span className="text-xs doux">Quatre idées à cuisiner</span>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {recettes.map((r) => (
          <li
            key={r.position}
            className="flex gap-3 rounded-xl border border-[var(--bordure)] p-2"
          >
            {r.imageUrl ? (
              <ImageRecette
                src={r.imageUrl}
                className="h-20 w-20 shrink-0 rounded-lg object-cover"
                lazy
              />
            ) : (
              <div
                className="h-20 w-20 shrink-0 rounded-lg"
                style={{ backgroundColor: "var(--surface-douce)" }}
                aria-hidden
              />
            )}
            <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
              <div className="min-w-0">
                <Link
                  href={`/catalogue/${r.catalogRecipeId}`}
                  className="line-clamp-2 text-sm font-medium underline-offset-2 hover:underline"
                >
                  {r.titre}
                </Link>
                <div className="mt-1 text-xs">
                  <Durees prep={r.prepMinutes} cuisson={r.cuissonMinutes} />
                </div>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => remplacer(r.position)}
                className="self-start rounded-lg border border-[var(--bordure)] px-3 py-2 text-xs disabled:opacity-50"
              >
                {enCours === r.position ? "…" : "Remplacer"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {batchCree === null ? (
        <button
          type="button"
          disabled={pending}
          onClick={monterLeBatch}
          className="bouton bouton-principal w-full disabled:opacity-50"
        >
          {pending ? "…" : "Créer le batch de la semaine"}
        </button>
      ) : (
        <Link href={`/batchs/${batchCree}`} className="bouton bouton-principal block w-full text-center">
          Batch créé — voir la liste d’épicerie
        </Link>
      )}

      {erreur && <p className="text-sm texte-erreur">{erreur}</p>}
    </section>
  );
}
