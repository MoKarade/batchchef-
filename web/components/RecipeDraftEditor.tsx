"use client";

// Écran de VALIDATION d'une recette extraite, partagé par les deux imports (URL et vidéo).
// Une seule copie : deux écrans séparés divergeraient au premier champ ajouté, et c'est ici
// que se joue la précision — rien n'entre en base sans que Marc l'ait relu.

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { saveImportedRecipe, type RecipePreview } from "@/lib/actions";
import { IngredientFields, rowToEditable, type EditRow } from "@/components/IngredientFields";

interface Draft {
  title: string;
  /** Chaîne (et non `string | null`) : c'est un champ de saisie, vide = pas de lien. */
  sourceUrl: string;
  imageUrl: string | null;
  servings: string;
  servingsGuessed: boolean;
  instructions: string;
  rows: EditRow[];
}

function toDraft(r: RecipePreview): Draft {
  return {
    title: r.title,
    sourceUrl: r.sourceUrl ?? "",
    imageUrl: r.imageUrl,
    servings: String(r.servings),
    servingsGuessed: r.servingsGuessed,
    instructions: r.instructions ?? "",
    rows: r.ingredients.map((i) => ({
      name: i.name,
      qty: i.qty === null ? "" : String(i.qty),
      unit: i.unit,
      note: i.note ?? "",
    })),
  };
}

export function RecipeDraftEditor({
  preview,
  vignettes = [],
  onCancel,
  hint,
}: {
  preview: RecipePreview;
  /**
   * Écrans de la vidéo proposés comme PHOTO de la recette.
   *
   * Le prompt vidéo force `imageUrl` à null : sans ça, toute recette venue d'un reel
   * arrivait sans image et la bibliothèque était une grille de rectangles gris. Ce ne sont
   * pas des illustrations génériques — ce sont de vrais plans de SA vidéo.
   */
  vignettes?: string[];
  onCancel: () => void;
  /** Message de contexte propre à la source (ex. nombre d'images lues). */
  hint?: ReactNode;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(preview));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  /** Colle le lien depuis le presse-papiers — le geste qui suit un « Copier le lien ». */
  const collerLien = async () => {
    setError(null);
    try {
      const texte = (await navigator.clipboard.readText()).trim();
      if (!texte) {
        setError("Le presse-papiers est vide.");
        return;
      }
      setDraft((d) => ({ ...d, sourceUrl: texte }));
    } catch {
      // Refus dit, jamais avalé : sinon le bouton semblerait ne rien faire.
      setError("Le navigateur a refusé l’accès au presse-papiers — colle à la main.");
    }
  };

  const save = () =>
    startTransition(async () => {
      setError(null);
      const res = await saveImportedRecipe({
        title: draft.title,
        sourceUrl: draft.sourceUrl.trim() || null,
        // L'origine vient de l'aperçu, pas d'un champ : c'est le chemin d'import qui la
        // connaît, et le serveur la revérifie de toute façon.
        origine: preview.origine,
        imageUrl: draft.imageUrl,
        servings: Number(draft.servings) || 1,
        instructions: draft.instructions.trim() || null,
        ingredients: draft.rows.map(rowToEditable),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/recettes/${res.id}`);
    });

  return (
    <div className="space-y-3 carte p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Vérifie avant d’enregistrer</h2>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="text-sm doux underline"
        >
          Annuler
        </button>
      </div>
      {hint ?? (
        <p className="text-xs doux">
          Analyse relue par le LLM. Corrige le titre, les portions ou une quantité si besoin —
          c’est ce que tu valides qui est enregistré.
        </p>
      )}

      {/* La photo, en premier : c'est ce qu'on voit d'abord dans la bibliothèque. */}
      {(draft.imageUrl || vignettes.length > 0) && (
        <div className="space-y-2">
          {draft.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={draft.imageUrl}
              alt="Photo choisie pour la recette"
              className="aspect-video w-full rounded-xl object-cover"
            />
          ) : (
            <p className="rounded-xl border border-dashed p-4 text-center text-xs doux" style={{ borderColor: "var(--bordure)" }}>
              Aucune photo — la recette s’affichera sans image.
            </p>
          )}
          {vignettes.length > 0 && (
            <>
              <p className="text-xs doux">
                Photo de la recette — choisis un autre moment de la vidéo si celui-ci ne dit rien.
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {vignettes.map((vignette, i) => {
                  const actif = draft.imageUrl === vignette;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setDraft({ ...draft, imageUrl: vignette })}
                      disabled={pending}
                      aria-label={`Écran ${i + 1}`}
                      aria-pressed={actif}
                      className="shrink-0 overflow-hidden rounded-lg border-2"
                      style={{ borderColor: actif ? "var(--accent)" : "var(--bordure)" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={vignette} alt="" className="h-14 w-20 object-cover" />
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, imageUrl: null })}
                  disabled={pending}
                  className="shrink-0 rounded-lg border-2 px-3 text-xs doux"
                  style={{ borderColor: draft.imageUrl ? "var(--bordure)" : "var(--accent)" }}
                >
                  Sans photo
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <label className="block text-sm">
        <span className="mb-1 block doux">Titre</span>
        <input
          type="text"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          disabled={pending}
          className="champ"
        />
      </label>

      {/* Le lien de la source se saisit ICI et nulle part ailleurs : quand le partage
          Android démarre l'analyse tout seul, l'écran du formulaire est sauté — Marc ne
          voyait donc jamais le champ, et la recette finissait sans lien vers sa vidéo. */}
      <div className="text-sm">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="doux">Lien de la source (facultatif)</span>
          <button
            type="button"
            onClick={() => void collerLien()}
            disabled={pending}
            className="rounded-lg border border-[var(--bordure)] px-3 py-1 text-xs font-medium disabled:opacity-50 "
          >
            Coller
          </button>
        </div>
        <input
          type="url"
          inputMode="url"
          value={draft.sourceUrl}
          onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })}
          disabled={pending}
          placeholder="https://www.instagram.com/reel/…"
          className="champ text-sm"
        />
        <p className="mt-1 text-xs doux">
          Gardé avec la recette pour pouvoir revoir la vidéo plus tard. Rien n’est téléchargé
          depuis ce lien.
        </p>
      </div>

      <label className="flex items-center gap-3 text-sm">
        <span className="shrink-0 doux">Portions de référence</span>
        <input
          type="number"
          min={1}
          max={50}
          value={draft.servings}
          onChange={(e) => setDraft({ ...draft, servings: e.target.value, servingsGuessed: false })}
          disabled={pending}
          className="w-20 rounded-lg border border-[var(--bordure)] bg-white px-2 py-2 text-center tabular-nums  "
        />
      </label>
      {draft.servingsGuessed && (
        <p className="rounded-lg alerte p-2 text-xs">
          Aucune portion annoncée par la source : 4 est un défaut, pas une donnée. Toutes les
          quantités de la liste d’épicerie seront mises à l’échelle à partir de ce nombre.
        </p>
      )}

      <IngredientFields
        rows={draft.rows}
        onChange={(rows) => setDraft({ ...draft, rows })}
        disabled={pending}
      />

      <label className="block text-sm">
        <span className="mb-1 block doux">Préparation</span>
        <textarea
          value={draft.instructions}
          onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
          disabled={pending}
          rows={8}
          placeholder="Étapes de la recette"
          className="champ text-sm"
        />
      </label>

      {error && (
        <p className="rounded-lg erreur p-2 text-sm">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={pending || !draft.title.trim()}
        className="bouton bouton-principal w-full"
      >
        {pending ? "Enregistrement…" : "Enregistrer la recette"}
      </button>
    </div>
  );
}
