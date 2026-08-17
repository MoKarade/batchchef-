"use client";

// Défaire une déclaration « j'ai toujours ça ».
//
// Sans ce geste, un article déclaré par erreur resterait écarté du budget pour toujours.
// C'est la contrepartie du bouton « Placard » : toute déclaration doit pouvoir se reprendre.

import { useState, useTransition } from "react";
import { retirerDuGardeManger } from "@/lib/actions";

export function GestionGardeManger({
  articles,
}: {
  articles: { id: number; nom: string }[];
}) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const retirer = (id: number) =>
    startTransition(async () => {
      setErreur(null);
      const res = await retirerDuGardeManger(id);
      if (!res.ok) setErreur(res.error);
    });

  return (
    <div className="space-y-3">
      {erreur && <p className="rounded-lg erreur p-2 text-sm">{erreur}</p>}
      <ul className="carte divide-y divide-[var(--bordure)] overflow-hidden">
        {articles.map((article) => (
          <li key={article.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
            <span className="min-w-0 flex-1 truncate">{article.nom}</span>
            <button
              type="button"
              onClick={() => retirer(article.id)}
              disabled={pending}
              aria-label={`Retirer ${article.nom} du garde-manger`}
              className="shrink-0 rounded-lg border border-[var(--bordure)] px-3 py-2 text-sm doux disabled:opacity-60"
            >
              Retirer
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs doux">
        Retirer un article le remet dans le budget des prochaines listes.
      </p>
    </div>
  );
}
