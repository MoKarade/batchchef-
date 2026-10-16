"use client";

// Bloc « Préparer une commande » : la liste restante regroupée par rayon, et un bouton qui
// la copie telle quelle pour la recopier dans une commande d'épicerie en ligne.
// Les rayons sont APPROXIMATIFS (regroupement BatchChef, pas le plan du magasin) et l'écran
// le dit. Quantités brutes (g, ml, unités), aucun prix : voir `lib/listeParRayon.ts`.

import { useState } from "react";
import { EPICIER_PAR_DEFAUT, EPICIERS, lienRecherche } from "@/lib/epiciers";
import {
  construireTexteParRayon,
  grouperParRayon,
  ligneArticle,
  type ArticleListe,
} from "@/lib/listeParRayon";

export function CommandeEpicerie({ batchName, items }: { batchName: string; items: ArticleListe[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [epicierId, setEpicierId] = useState<string>(EPICIER_PAR_DEFAUT.id);
  const epicier = EPICIERS.find((e) => e.id === epicierId) ?? EPICIER_PAR_DEFAUT;
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

      <div className="space-y-1">
        <label htmlFor="commande-epicier" className="text-sm font-semibold">
          Chercher chez
        </label>
        <select
          id="commande-epicier"
          className="champ w-full"
          value={epicier.id}
          onChange={(e) => setEpicierId(e.target.value)}
        >
          {EPICIERS.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nom}
            </option>
          ))}
        </select>
        <p className="text-sm doux">
          Chaque lien ouvre la recherche du site dans ton navigateur. BatchChef ne lit ni prix ni stock.
        </p>
      </div>

      <div className="space-y-3">
        {groupes.map((g) => (
          <div key={g.rayon}>
            <h3 className="text-sm font-semibold">{g.rayon}</h3>
            <ul className="text-sm">
              {g.articles.map((a, i) => {
                const lien = lienRecherche(epicier, a.name);
                return (
                  <li
                    key={`${a.canonical}|${a.unit ?? ""}|${i}`}
                    className="flex min-h-11 items-center justify-between gap-3"
                  >
                    <span>{ligneArticle(a)}</span>
                    {lien && (
                      <a
                        href={lien}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex min-h-11 shrink-0 items-center underline"
                        aria-label={`Chercher ${a.name} chez ${epicier.nom} (nouvel onglet)`}
                      >
                        Chercher
                      </a>
                    )}
                  </li>
                );
              })}
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
