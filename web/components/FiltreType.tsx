"use client";

// Filtre par type de plat sur le catalogue (SEM-01). Une rangée de pastilles, pas un menu
// déroulant : sur téléphone, un choix visible en un coup d'oeil bat un choix qu'il faut ouvrir.
//
// ⚠️ « Non déterminé » est une valeur COMME LES AUTRES, et elle se filtre. Le classement est
// une estimation : pouvoir regarder ce qu'elle n'a pas su trancher, c'est ce qui permet de
// corriger — la cacher reviendrait à faire comme si elle n'existait pas.

import { useRouter, useSearchParams } from "next/navigation";
import { FAMILLES, LIBELLES } from "@/lib/typePlat";

export const TYPE_INCONNU = "inconnu";

export function FiltreType({ actif }: { actif: string | null }) {
  const router = useRouter();
  const params = useSearchParams();

  const aller = (valeur: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (valeur) p.set("type", valeur);
    else p.delete("type");
    p.delete("p"); // changer de filtre remet à la première page, sinon on atterrit dans le vide
    const qs = p.toString();
    router.push(qs ? `/catalogue?${qs}` : "/catalogue");
  };

  const pastille = (valeur: string | null, libelle: string) => {
    const choisi = actif === valeur;
    return (
      <button
        key={valeur ?? "tous"}
        type="button"
        onClick={() => aller(valeur)}
        aria-pressed={choisi}
        className={`rounded-full border px-3 py-2 text-xs ${
          choisi ? "sur-accent border-transparent" : "border-[var(--bordure)]"
        }`}
        style={choisi ? { backgroundColor: "var(--accent)" } : undefined}
      >
        {libelle}
      </button>
    );
  };

  return (
    <div className="flex flex-wrap gap-2">
      {pastille(null, "Tous")}
      {FAMILLES.map((f) => pastille(f, LIBELLES[f]))}
      {pastille(TYPE_INCONNU, "Non déterminé")}
    </div>
  );
}
