"use client";

// Import d'une recette depuis une VIDÉO (reel Instagram, TikTok, Short…), en deux temps :
//   1. « Analyser » : les images sont extraites DANS LE NAVIGATEUR (la vidéo ne quitte pas
//      le PC), puis envoyées avec la description au LLM. Rien n'est sauvé.
//   2. Écran de VALIDATION partagé (RecipeDraftEditor) → « Enregistrer ».
//
// L'app ne va rien chercher chez Instagram (pas de scraping) : Marc fournit la vidéo et/ou
// la description, le lien ne sert que de source affichée sur la recette.

import { useRef, useState } from "react";
import { parseRecipeFromVideo, type RecipePreview } from "@/lib/actions";
import { RecipeDraftEditor } from "@/components/RecipeDraftEditor";
import { captureFrames } from "@/lib/video/capture";

type Phase = { kind: "idle" } | { kind: "lecture"; done: number; total: number } | { kind: "analyse" };

interface Lu {
  frames: number;
  dropped: number;
}

export function ImportVideoForm() {
  const [lien, setLien] = useState("");
  const [description, setDescription] = useState("");
  const [fichier, setFichier] = useState<File | null>(null);
  const [preview, setPreview] = useState<RecipePreview | null>(null);
  const [lu, setLu] = useState<Lu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const inputFichier = useRef<HTMLInputElement>(null);

  const busy = phase.kind !== "idle";
  const pretAAnalyser = Boolean(fichier) || description.trim().length > 0;

  const reset = () => {
    setPreview(null);
    setLu(null);
  };

  const analyser = async () => {
    setError(null);
    let frames: string[] = [];
    let dropped = 0;

    try {
      if (fichier) {
        setPhase({ kind: "lecture", done: 0, total: 0 });
        const capture = await captureFrames(fichier, (done, total) =>
          setPhase({ kind: "lecture", done, total }),
        );
        frames = capture.frames;
        dropped = capture.dropped;
      }

      setPhase({ kind: "analyse" });
      const res = await parseRecipeFromVideo({
        frames,
        caption: description,
        sourceUrl: lien.trim() || null,
      });
      if (!res.ok || !res.recipe) {
        setError(res.ok ? "Rien à valider." : res.error);
        return;
      }
      setLu({ frames: frames.length, dropped });
      setPreview(res.recipe);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPhase({ kind: "idle" });
    }
  };

  if (preview) {
    return (
      <RecipeDraftEditor
        preview={preview}
        onCancel={reset}
        hint={
          <p className="text-xs text-stone-500">
            {lu && lu.frames > 0
              ? `${lu.frames} image(s) lue(s) dans la vidéo${lu.dropped > 0 ? ` (${lu.dropped} écartée(s), trop lourdes)` : ""}${description.trim() ? " + description" : ", sans description"}.`
              : "Recette lue depuis la description seule."}{" "}
            Une vidéo annonce rarement les quantités exactes : relis chaque ligne, c’est ce que
            tu valides qui est enregistré.
          </p>
        }
      />
    );
  }

  return (
    <form
      className="space-y-3 rounded-2xl border border-stone-200 p-4 dark:border-stone-800"
      onSubmit={(e) => {
        e.preventDefault();
        void analyser();
      }}
    >
      <div>
        <h2 className="font-semibold">Depuis une vidéo</h2>
        <p className="mt-1 text-xs text-stone-500">
          Un reel de cuisine : dépose la vidéo, colle sa description, ou les deux. La vidéo est
          lue dans ton navigateur — elle n’est jamais envoyée telle quelle.
        </p>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-stone-500">Lien du reel (facultatif)</span>
        <input
          type="url"
          value={lien}
          onChange={(e) => setLien(e.target.value)}
          placeholder="https://www.instagram.com/reel/…"
          disabled={busy}
          className="w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
        />
      </label>

      <div className="text-sm">
        <span className="mb-1 block text-stone-500">Vidéo</span>
        <input
          ref={inputFichier}
          type="file"
          accept="video/*"
          onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
          disabled={busy}
          className="w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-1 file:text-sm dark:border-stone-700 dark:bg-stone-900 dark:file:bg-stone-800"
        />
        {fichier && (
          <p className="mt-1 text-xs text-stone-500">
            {fichier.name} · {(fichier.size / 1_000_000).toFixed(1)} Mo
          </p>
        )}
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-stone-500">
          Description publiée avec la vidéo (recommandé)
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          placeholder="Colle ici le texte de la publication : c’est presque toujours là que sont les quantités."
          disabled={busy}
          className="w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
        />
      </label>

      <button
        type="submit"
        disabled={busy || !pretAAnalyser}
        className="w-full rounded-xl px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: "var(--accent)" }}
      >
        {busy ? "Analyse…" : "Analyser la vidéo"}
      </button>

      {phase.kind === "lecture" && (
        <p className="text-xs text-stone-500">
          Lecture de la vidéo{phase.total > 0 ? ` — image ${phase.done}/${phase.total}` : "…"}
        </p>
      )}
      {phase.kind === "analyse" && (
        <p className="text-xs text-stone-500">
          Extraction de la recette (ingrédients + préparation), 20-40 s…
        </p>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
