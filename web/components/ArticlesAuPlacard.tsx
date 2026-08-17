"use client";

// « À vérifier au placard » — les articles du garde-manger, sortis de la liste principale
// mais TOUJOURS LÀ.
//
// ⚠️ C'est la moitié qui compte du garde-manger. Retirer ces lignes serait facile à coder et
// ferait rentrer Marc sans son huile le jour où le pot est vide — et l'app ne le saurait
// jamais. Elles sont donc repliées, pas supprimées, et restent cochables : un coup d'œil au
// placard avant de partir, et si l'un manque il se coche comme les autres.

import { useState } from "react";
import { toggleShoppingItem } from "@/lib/actions";
import { formatQty } from "@/lib/aggregate";
import { formatMontant } from "@/lib/courses";

interface Article {
  id: number;
  name: string;
  qty: number | null;
  unit: "g" | "ml" | "unite" | null;
  estCost: number | null;
  checked: boolean;
}

export function ArticlesAuPlacard({ articles: initiaux }: { articles: Article[] }) {
  const [articles, setArticles] = useState(initiaux);
  const [erreur, setErreur] = useState(false);

  const basculer = (article: Article) => {
    const suivant = !article.checked;
    setArticles((prec) =>
      prec.map((a) => (a.id === article.id ? { ...a, checked: suivant } : a)),
    );
    void toggleShoppingItem(article.id, suivant).then((res) => {
      if (!res.ok) {
        setArticles((prec) =>
          prec.map((a) => (a.id === article.id ? { ...a, checked: !suivant } : a)),
        );
        setErreur(true);
      } else {
        setErreur(false);
      }
    });
  };

  // Le montant est DIT, pas caché : c'est ce que la liste principale n'affiche plus, et
  // taire un total qu'on a retiré serait la version polie du mensonge.
  const montantEcarte = articles.reduce((somme, a) => somme + (a.estCost ?? 0), 0);
  const incomplet = articles.some((a) => a.estCost === null);

  return (
    <details className="carte overflow-hidden">
      <summary className="cursor-pointer px-4 py-3 font-medium">
        À vérifier au placard ({articles.length})
        <span className="ml-2 text-sm font-normal doux">
          {formatMontant(montantEcarte)}
          {incomplet ? "+" : ""} hors du total
        </span>
      </summary>
      <div className="border-t border-[var(--bordure)]">
        <p className="px-4 py-3 text-xs doux">
          Tu as déclaré avoir toujours ces articles. Ils ne comptent plus dans le budget, mais
          ils restent ici : si l’un manque, coche-le comme les autres.
        </p>
        {erreur && (
          <p className="mx-4 mb-3 rounded-lg erreur p-2 text-sm">
            Échec de sauvegarde (réseau ?) — la case a été remise.
          </p>
        )}
        <ul className="divide-y divide-[var(--bordure)]">
          {articles.map((article) => (
            <li key={article.id}>
              <button
                type="button"
                onClick={() => basculer(article)}
                aria-pressed={article.checked}
                className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2"
                  style={{
                    borderColor: article.checked ? "var(--accent)" : "var(--bordure)",
                    backgroundColor: article.checked ? "var(--accent)" : "transparent",
                    color: "var(--sur-accent)",
                  }}
                >
                  {article.checked && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m5 12.5 4.5 4.5L19 7" />
                    </svg>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={article.checked ? "line-through" : ""}
                    style={{ color: "var(--texte-doux)" }}
                  >
                    {article.name}
                  </span>
                  <span className="ml-2 text-sm tabular-nums doux">
                    {formatQty(article.qty, article.unit)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
