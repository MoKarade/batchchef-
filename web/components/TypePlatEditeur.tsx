"use client";

// L'étiquette de type sur une fiche du catalogue, et sa correction (SEM-01).
//
// ⚠️ Le classement est une ESTIMATION, et l'écran le DIT tant que Marc ne l'a pas corrigé.
// Une estimation présentée comme une donnée, c'est exactement ce que « no fake data »
// interdit ailleurs dans l'app — le type d'un plat n'y échappe pas.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { corrigerTypeRecette } from "@/lib/actions";
import { FAMILLES, LIBELLES, type TypePlat } from "@/lib/typePlat";

export function TypePlatEditeur({
  catalogRecipeId,
  type,
  corrige,
}: {
  catalogRecipeId: number;
  type: TypePlat | null;
  corrige: boolean;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const choisir = (valeur: TypePlat | null) =>
    startTransition(async () => {
      setErreur(null);
      const res = await corrigerTypeRecette(catalogRecipeId, valeur);
      if (!res.ok) setErreur(res.error);
      else {
        setOuvert(false);
        router.refresh();
      }
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full border border-[var(--bordure)] px-3 py-1">
          {type ? LIBELLES[type] : "Type non déterminé"}
        </span>
        {!corrige && type && <span className="text-xs doux">estimé</span>}
        {corrige && <span className="text-xs doux">corrigé par toi</span>}
        <button
          type="button"
          disabled={pending}
          onClick={() => setOuvert((v) => !v)}
          className="text-xs underline disabled:opacity-50"
        >
          {ouvert ? "Fermer" : "Corriger"}
        </button>
      </div>

      {ouvert && (
        <div className="flex flex-wrap gap-2">
          {FAMILLES.map((f) => (
            <button
              key={f}
              type="button"
              disabled={pending}
              onClick={() => choisir(f)}
              className="rounded-full border border-[var(--bordure)] px-3 py-2 text-xs disabled:opacity-50"
            >
              {LIBELLES[f]}
            </button>
          ))}
          <button
            type="button"
            disabled={pending}
            onClick={() => choisir(null)}
            className="rounded-full border border-dashed border-[var(--bordure)] px-3 py-2 text-xs disabled:opacity-50"
          >
            Aucune de ces familles
          </button>
        </div>
      )}

      {erreur && <p className="text-sm texte-erreur">{erreur}</p>}
    </div>
  );
}
