"use client";

// Bloc « Préparer une commande » : la liste restante regroupée par rayon, et un bouton qui
// la copie telle quelle pour la recopier dans une commande d'épicerie en ligne.
// Les rayons sont APPROXIMATIFS (regroupement BatchChef, pas le plan du magasin) et l'écran
// le dit. Quantités brutes (g, ml, unités), aucun prix : voir `lib/listeParRayon.ts`.

import { useState } from "react";
import {
  construireTexteParRayon,
  grouperParRayon,
  ligneArticle,
  type ArticleListe,
} from "@/lib/listeParRayon";

export function CommandeEpicerie({ batchName, items }: { batchName: string; items: ArticleListe[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const texte = construireTexteParRayon(batchName, items);
  if (!texte) return null;
  const groupes = grouperParRayon(items);

  const copier = async () => {
    setMsg(null);
    try {
      await navigator.clipboard.writeText(`${texte.title}\n\n${texte.body}`);
      setMsg("Liste copiée, un rayon par paragraphe.");
    } catch {
      setMsg("Copie impossible sur cet appareil : recopie la liste ci-dessus.");
    }
  };

  return (
    <section className="space-y-3" aria-labelledby="commande-titre">
      <div>
        <h2 id="commande-titre" className="font-semibold">
          Préparer une commande
        </h2>
        <p className="text-sm doux">
          Rayons approximatifs (regroupement BatchChef, pas le plan du magasin). Quantités à
          acheter, sans format d’emballage.
        </p>
      </div>

      <div className="space-y-3">
        {groupes.map((g) => (
          <div key={g.rayon}>
            <h3 className="text-sm font-semibold">{g.rayon}</h3>
            <ul className="text-sm">
              {g.articles.map((a, i) => (
                <li key={`${a.canonical}|${a.unit ?? ""}|${i}`}>{ligneArticle(a)}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="space-y-1">
        <button type="button" onClick={copier} className="bouton bouton-second w-full">
          Copier la liste par rayon
        </button>
        {msg && (
          <p className="text-center text-sm doux" role="status">
            {msg}
          </p>
        )}
      </div>
    </section>
  );
}
