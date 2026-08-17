"use client";

// « Qu'est-ce que je mange ? » — la moitié de la semaine qui manquait à l'app.
//
// Écran de cuisine, debout, une main occupée : le geste principal (« j'en mange une ») est
// une grosse cible, et l'ordre fait le travail — le frigo d'abord, le plus ancien en tête.

import { useState, useTransition } from "react";
import { consommerPortion } from "@/lib/actions";
import {
  LIBELLE_ZONE,
  REPERE_JOURS,
  ZONES,
  ageEnJours,
  compterPortions,
  formatAge,
  passeLeRepere,
  trierPortions,
  type LignePortions,
} from "@/lib/portions";

export function ListePortions({ lignes }: { lignes: LignePortions[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // `maintenant` est figé au premier rendu : recalculer à chaque re-rendu ferait sauter
  // un âge d'un jour en pleine interaction, à minuit.
  const [maintenant] = useState(() => new Date());

  const triees = trierPortions(lignes);
  const { parZone } = compterPortions(lignes);

  const manger = (id: number) =>
    startTransition(async () => {
      setError(null);
      const res = await consommerPortion(id);
      if (!res.ok) setError(res.error);
    });

  return (
    <div className="space-y-5">
      {error && <p className="rounded-lg erreur p-2 text-sm">{error}</p>}

      {ZONES.map((zone) => {
        const deLaZone = triees.filter((l) => l.zone === zone);
        if (deLaZone.length === 0) return null;
        return (
          <section key={zone} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-semibold">{LIBELLE_ZONE[zone]}</h2>
              <span className="text-sm tabular-nums doux">
                {parZone[zone]} portion{parZone[zone] > 1 ? "s" : ""}
              </span>
            </div>
            <ul className="space-y-2">
              {deLaZone.map((ligne) => {
                const age = ageEnJours(ligne.rangeLe, maintenant);
                const vieille = passeLeRepere(zone, age);
                return (
                  <li key={ligne.id} className="flex items-center gap-3 carte p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{ligne.titre}</p>
                      <p className="mt-0.5 text-xs doux">
                        Rangé {formatAge(age)}
                        {vieille && (
                          <>
                            {" · "}
                            {/* Un REPÈRE, pas un verdict : l'app ne sait rien de ce qu'il y
                                a dans la boîte. On fait remonter, on ne condamne pas. */}
                            <span className="font-medium">
                              au-delà du repère de {REPERE_JOURS[zone]} jours
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <span className="shrink-0 tabular-nums text-lg font-bold">
                      {ligne.restantes}
                    </span>
                    <button
                      type="button"
                      onClick={() => manger(ligne.id)}
                      disabled={pending}
                      aria-label={`J’en mange une : ${ligne.titre}`}
                      className="bouton bouton-second shrink-0"
                    >
                      J’en mange une
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
