"use client";

// Le geste de fin de batch : « tu as cuisiné, tu ranges quoi où ? »
//
// Marc a choisi deux zones distinctes (frigo / congélo) : leurs durées de vie n'ont rien à
// voir, et c'est au moment où il empile les contenants qu'il sait où chacun va. Le nombre
// de portions est PRÉ-REMPLI depuis le batch, mais reste modifiable — la vraie vie donne
// souvent un contenant de plus ou de moins, et deux portions mangées le soir même.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { terminerBatch } from "@/lib/actions";
import { LIBELLE_ZONE, ZONES, type Zone } from "@/lib/portions";

export interface RecetteARanger {
  recipeId: number;
  titre: string;
  portions: number;
}

interface Ligne {
  recipeId: number;
  titre: string;
  portions: string;
  zone: Zone;
}

export function RangementBatch({
  batchId,
  recettes,
  onAnnuler,
}: {
  batchId: number;
  recettes: RecetteARanger[];
  onAnnuler: () => void;
}) {
  const [lignes, setLignes] = useState<Ligne[]>(() =>
    recettes.map((r) => ({
      recipeId: r.recipeId,
      titre: r.titre,
      portions: String(r.portions),
      zone: "congelo" as Zone,
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const majLigne = (i: number, champ: Partial<Ligne>) =>
    setLignes((prec) => prec.map((l, j) => (j === i ? { ...l, ...champ } : l)));

  const ranger = () =>
    startTransition(async () => {
      setError(null);
      const res = await terminerBatch(
        batchId,
        lignes.map((l) => ({
          recipeId: l.recipeId,
          titre: l.titre,
          zone: l.zone,
          // `Number("")` vaut 0 et non NaN : une case vidée veut dire « rien rangé »,
          // ce que la validation écarte sans crier.
          portions: Number(l.portions.trim() || 0),
        })),
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/portions");
    });

  return (
    <div className="space-y-3 carte p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Tu ranges quoi, et où ?</h2>
        <button
          type="button"
          onClick={onAnnuler}
          disabled={pending}
          className="text-sm doux underline"
        >
          Annuler
        </button>
      </div>
      <p className="text-xs doux">
        Corrige le nombre si tu as fait plus, moins, ou si vous avez mangé ce soir. Une ligne
        à 0 n’est simplement pas rangée.
      </p>

      <ul className="space-y-3">
        {lignes.map((ligne, i) => (
          <li key={ligne.recipeId} className="space-y-2 border-t border-[var(--bordure)] pt-3">
            <p className="font-medium">{ligne.titre}</p>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <span className="doux">Portions</span>
                <input
                  type="number"
                  min={0}
                  max={99}
                  inputMode="numeric"
                  value={ligne.portions}
                  onChange={(e) => majLigne(i, { portions: e.target.value })}
                  disabled={pending}
                  className="w-20 rounded-lg border border-[var(--bordure)] bg-[var(--surface)] px-2 py-2 text-center tabular-nums"
                />
              </label>
              <div
                className="ml-auto flex gap-1 rounded-xl border border-[var(--bordure)] p-1"
                role="group"
                aria-label={`Où ranger ${ligne.titre}`}
              >
                {ZONES.map((zone) => {
                  const actif = ligne.zone === zone;
                  return (
                    <button
                      key={zone}
                      type="button"
                      disabled={pending}
                      aria-pressed={actif}
                      onClick={() => majLigne(i, { zone })}
                      className={`rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-60 ${
                        actif ? "sur-accent" : "doux"
                      }`}
                      style={actif ? { backgroundColor: "var(--accent)" } : undefined}
                    >
                      {LIBELLE_ZONE[zone]}
                    </button>
                  );
                })}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {error && <p className="rounded-lg erreur p-2 text-sm">{error}</p>}

      <button
        type="button"
        onClick={ranger}
        disabled={pending}
        className="bouton bouton-principal w-full"
      >
        {pending ? "Rangement…" : "Ranger et terminer le batch"}
      </button>
    </div>
  );
}
