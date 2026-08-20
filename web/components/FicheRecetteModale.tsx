"use client";

// La fiche d'une recette, ouverte PAR-DESSUS le chat.
//
// ⚠️ C'est tout l'enjeu : la conversation vit dans l'état d'un composant client. Naviguer
// vers /recettes/12 la détruirait, et Marc perdrait l'échange qui vient de produire la
// suggestion. La fiche est donc une surcouche — on l'ouvre, on la ferme, le chat n'a pas
// bougé d'un pixel.
//
// `<dialog>` natif plutôt qu'une div : Échap pour fermer, focus piégé et fond inerte sont
// donnés par le navigateur. Les réécrire à la main, c'est les réécrire à moitié.

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { FicheRecette } from "@/lib/actions";
import { ImageRecette } from "@/components/ImageRecette";

export function FicheRecetteModale({
  fiche,
  chargement,
  erreur,
  onFermer,
}: {
  fiche: FicheRecette | null;
  chargement: boolean;
  erreur: string | null;
  onFermer: () => void;
}) {
  const dialogue = useRef<HTMLDialogElement>(null);
  const ouvert = chargement || Boolean(fiche) || Boolean(erreur);

  useEffect(() => {
    const el = dialogue.current;
    if (!el) return;
    if (ouvert && !el.open) el.showModal();
    if (!ouvert && el.open) el.close();
  }, [ouvert]);

  return (
    <dialog
      ref={dialogue}
      // `cancel` couvre Échap ET le geste de retour : sans lui, la modale se fermerait
      // côté navigateur sans que React le sache, et le prochain clic ne rouvrirait rien.
      onCancel={(e) => {
        e.preventDefault();
        onFermer();
      }}
      onClick={(e) => {
        // Clic sur le fond (hors du contenu) = fermer, comme partout ailleurs.
        if (e.target === dialogue.current) onFermer();
      }}
      className="w-[min(92vw,32rem)] rounded-2xl border border-[var(--bordure)] p-0 backdrop:bg-black/50"
      style={{ backgroundColor: "var(--surface)", color: "var(--texte)" }}
      aria-label="Fiche de la recette"
    >
      <div className="max-h-[80vh] overflow-y-auto">
        {chargement && <p className="p-6 text-sm doux">Ouverture de la recette…</p>}

        {erreur && (
          <div className="space-y-3 p-6">
            <p className="rounded-lg erreur p-3 text-sm">{erreur}</p>
            <button type="button" onClick={onFermer} className="bouton bouton-second w-full">
              Retour à la conversation
            </button>
          </div>
        )}

        {fiche && (
          <div className="space-y-4">
            {fiche.imageUrl && (
               
              <ImageRecette src={fiche.imageUrl} className="aspect-video w-full object-cover" />
            )}
            <div className="space-y-4 p-5">
              <div>
                <h2 className="text-xl font-bold">{fiche.titre}</h2>
                <p className="mt-1 text-sm doux">
                  {fiche.source === "catalogue" ? "Catalogue" : "Ta bibliothèque"} · pour{" "}
                  {fiche.servings} portion{fiche.servings > 1 ? "s" : ""}
                </p>
              </div>

              <section>
                <h3 className="mb-2 font-semibold">Ingrédients</h3>
                {fiche.ingredients.length === 0 ? (
                  <p className="text-sm doux">Aucun ingrédient enregistré.</p>
                ) : (
                  <ul className="divide-y divide-[var(--bordure)]">
                    {fiche.ingredients.map((ing, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                        <span>
                          {ing.nom}
                          {ing.note && <span className="doux"> — {ing.note}</span>}
                        </span>
                        <span className="shrink-0 tabular-nums doux">{ing.quantite}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {fiche.instructions && (
                <section>
                  <h3 className="mb-2 font-semibold">Préparation</h3>
                  <p className="whitespace-pre-line text-sm leading-relaxed">
                    {fiche.instructions}
                  </p>
                </section>
              )}

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={onFermer}
                  className="bouton bouton-principal w-full"
                >
                  Retour à la conversation
                </button>
                {/* Ce lien QUITTE le chat : c'est dit, parce que la conversation ne survit
                    pas à une navigation. */}
                <Link
                  href={
                    fiche.source === "catalogue"
                      ? `/catalogue/${fiche.id}`
                      : `/recettes/${fiche.id}`
                  }
                  className="block text-center text-xs doux underline"
                >
                  Ouvrir la fiche complète (quitte la conversation)
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
