"use client";

// components/BlocsAtelier.tsx — ce que l'atelier de LIA dessine sous une réponse de l'assistant (tâche #346).
//
// Deux blocs, catalogue FERMÉ (`BlocAtelier` dans lib/lia/contrat.ts) : une recette citée (bouton qui ouvre sa fiche PAR-DESSUS
// la page) et un remplacement proposé (la carte qui montre l'aperçu avant le geste). lia-ui appelle `dessinerBlocs` avec les blocs
// de la réponse ; un bloc inconnu ou mal formé n'est pas dessiné (jamais deviné). Les titres sont des données de la base,
// affichés comme texte React.

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { lireFicheRecette, type FicheRecette } from "@/lib/actions/assistant";
import { CartePlacement } from "@/components/CartePlacement";
import { FicheRecetteModale } from "@/components/FicheRecetteModale";
import { blocsValides } from "@/lib/assistant/atelier";
import type { BlocAtelier } from "@/lib/lia/contrat";

function BlocsAtelier({ blocs }: { blocs: readonly BlocAtelier[] }) {
  const [fiche, setFiche] = useState<FicheRecette | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const ouvrir = (source: "catalogue" | "mes-recettes", id: number) => {
    setFiche(null);
    setErreur(null);
    setChargement(true);
    void lireFicheRecette(id, source).then((res) => {
      setChargement(false);
      if (!res.ok) setErreur(res.error);
      else setFiche(res.fiche ?? null);
    });
  };
  const fermer = () => {
    setFiche(null);
    setErreur(null);
    setChargement(false);
  };

  return (
    <div className="mt-2 grid gap-2">
      {blocs.map((b) =>
        b.type === "recette" ? (
          <button
            key={`${b.source}#${b.id}`}
            type="button"
            onClick={() => ouvrir(b.source, b.id)}
            className="bouton bouton-second w-full justify-start! text-left"
          >
            Voir la recette : {b.titre}
          </button>
        ) : (
          <CartePlacement key={`place${b.place}`} place={b.place} id={b.id} />
        ),
      )}
      <FicheRecetteModale fiche={fiche} chargement={chargement} erreur={erreur} onFermer={fermer} />
    </div>
  );
}

/** Le `renderBlocks` de lia-ui : dessine à la fin de `dans`, dans sa propre racine React. */
export function dessinerBlocs(blocs: readonly unknown[], dans: HTMLElement): void {
  const valides = blocsValides(blocs);
  if (valides.length === 0) return;
  const racine = document.createElement("div");
  dans.appendChild(racine);
  createRoot(racine).render(<BlocsAtelier blocs={valides} />);
}
