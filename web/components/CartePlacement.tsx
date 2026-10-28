"use client";

// components/CartePlacement.tsx — la carte d'une proposition de remplacement (SEM-03) : « mets celle-là à la place 3 ».
// Sortie de l'ancien chat (`Conversation`) quand /assistant est devenu l'atelier de LIA (#346) ; la carte est dessinée dans les
// blocs de réponse de LIA (`components/BlocsAtelier.tsx`).

import { useEffect, useRef, useState } from "react";
import { apercuPlacementSemaine, placerRecetteSemaine } from "@/lib/actions/semaine";
// ⚠️ Le TYPE vient du module ordinaire, jamais du fichier "use server" : celui-ci ne peut
// exporter que des fonctions async, et y ajouter un type casse le build.
import type { ApercuPlacement } from "@/lib/semaineDb";

/**
 * ⚠️ Elle charge un APERÇU avant d'offrir le bouton. Deux raisons, et aucune n'est du
 * confort : Marc doit voir CE QU'IL REMPLACE (la place porte déjà une recette), et il doit
 * voir quand le remplacement CASSE la composition « 3 plats + 1 dessert ». Son clic vaut
 * demande explicite — il ne peut valoir demande explicite que s'il sait ce qu'il demande.
 *
 * ⚠️ Un aperçu en échec ne rend AUCUN bouton : la cause est affichée à la place. Un bouton
 * qui tenterait le placement « pour voir » serait une promesse creuse de plus.
 */
export function CartePlacement({ place, id }: { place: number; id: number }) {
  const [apercu, setApercu] = useState<ApercuPlacement | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pose, setPose] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const demande = useRef(false);

  useEffect(() => {
    // ⚠️ Une seule fois par carte : sans ce garde, un re-rendu relancerait la lecture.
    if (demande.current) return;
    demande.current = true;
    void apercuPlacementSemaine(place, id).then((res) => {
      if (res.ok) setApercu(res.apercu);
      else setErreur(res.error);
    });
  }, [place, id]);

  const poser = () => {
    setEnCours(true);
    setErreur(null);
    void placerRecetteSemaine(place, id).then((res) => {
      setEnCours(false);
      if (res.ok) setPose(res.titre ?? apercu?.titre ?? "Recette");
      else setErreur(res.error);
    });
  };

  if (erreur) {
    return (
      <span className="bandeau erreur my-1 text-sm" role="alert">
        {erreur}
      </span>
    );
  }
  if (pose) {
    // ⚠️ L'assistant vit sur /assistant, la carte « Ta semaine » sur l'accueil : Marc ne verra
    // rien bouger. Le dire est la seule confirmation qu'il aura.
    return (
      <span className="bandeau succes my-1 text-sm" role="status">
        {pose} est posée à la place {place} de ta semaine.
      </span>
    );
  }
  if (!apercu) {
    return <span className="mx-0.5 align-baseline text-sm doux">…</span>;
  }

  return (
    <span className="carte my-2 block p-3 text-sm">
      <span className="block">
        Mettre <strong>{apercu.titre}</strong> à la place {place}, à la place de{" "}
        <strong>{apercu.titreActuel}</strong>.
      </span>
      {apercu.casseComposition && (
        <span className="bandeau alerte mt-2">
          Cette place attend {apercu.roleAttendu === "dessert" ? "un dessert" : "un plat, une soupe ou une salade"} :
          ta semaine ne sera plus « trois plats et un dessert ».
        </span>
      )}
      <button
        type="button"
        disabled={enCours}
        onClick={poser}
        className="bouton bouton-second mt-2 w-full disabled:opacity-50"
      >
        {enCours ? "…" : `Mettre à la place ${place}`}
      </button>
    </span>
  );
}
