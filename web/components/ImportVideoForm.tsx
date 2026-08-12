"use client";

// Import d'une recette depuis une publication (reel Instagram, TikTok, Short), en deux temps :
//   1. « Analyser » : la vidéo est découpée en images DANS LE NAVIGATEUR et les captures
//      d'écran y sont réduites ; seules ces images partent au serveur. Rien n'est sauvé.
//   2. Écran de VALIDATION partagé (RecipeDraftEditor) → « Enregistrer ».
//
// Trois sources, toutes facultatives, au moins une requise :
//   - la VIDÉO (ce qui n'est montré qu'à l'écran) ;
//   - des CAPTURES D'ÉCRAN de la légende (le moyen de récupérer un texte qu'on ne peut pas
//     copier — le modèle vision les LIT) ;
//   - la DESCRIPTION collée.
//
// L'app ne va rien chercher chez Instagram (pas de scraping) : Marc fournit ce à quoi il a
// accès, le lien ne sert que de source affichée.

import { useEffect, useRef, useState } from "react";
import { parseRecipeFromVideo, type RecipePreview } from "@/lib/actions";
import { RecipeDraftEditor } from "@/components/RecipeDraftEditor";
import { captureFrames, reduireImage } from "@/lib/video/capture";
import { MAX_TOTAL_BASE64_BYTES, base64Bytes, repartirBudget } from "@/lib/video/frames";

type Phase =
  | { kind: "idle" }
  | { kind: "captures" }
  | { kind: "lecture"; done: number; total: number }
  | { kind: "analyse" };

interface Lu {
  frames: number;
  captures: number;
  ecartees: number;
}

export interface ImportVideoFormProps {
  /** Valeurs pré-remplies (partage Android : cf. app/partage). */
  lienInitial?: string;
  descriptionInitiale?: string;
  fichierInitial?: File | null;
  capturesInitiales?: File[];
  /** Lance l'analyse dès l'affichage — utilisé quand le partage a apporté des images. */
  demarrerAuto?: boolean;
}

export function ImportVideoForm({
  lienInitial = "",
  descriptionInitiale = "",
  fichierInitial = null,
  capturesInitiales = [],
  demarrerAuto = false,
}: ImportVideoFormProps = {}) {
  const [lien, setLien] = useState(lienInitial);
  const [description, setDescription] = useState(descriptionInitiale);
  const [fichier, setFichier] = useState<File | null>(fichierInitial);
  const [captures, setCaptures] = useState<File[]>(capturesInitiales);
  const [preview, setPreview] = useState<RecipePreview | null>(null);
  const [lu, setLu] = useState<Lu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const dejaLance = useRef(false);

  const busy = phase.kind !== "idle";
  const pretAAnalyser = Boolean(fichier) || captures.length > 0 || description.trim().length > 0;

  const reset = () => {
    setPreview(null);
    setLu(null);
  };

  /** Colle la description depuis le presse-papiers (le geste après un « Copier » dans Instagram). */
  const collerDescription = async () => {
    setError(null);
    try {
      const texte = await navigator.clipboard.readText();
      if (!texte.trim()) {
        setError("Le presse-papiers est vide.");
        return;
      }
      setDescription((actuel) => (actuel.trim() ? `${actuel}\n${texte}` : texte));
    } catch {
      // Refus dit, jamais avalé : sinon le bouton semblerait ne rien faire.
      setError("Le navigateur a refusé l’accès au presse-papiers — colle à la main ci-dessous.");
    }
  };

  const analyser = async () => {
    setError(null);
    let frames: string[] = [];
    let capturesB64: string[] = [];
    let ecartees = 0;

    try {
      // 1. Les captures d'abord : elles portent le texte, donc les quantités.
      if (captures.length > 0) {
        setPhase({ kind: "captures" });
        const toutes = await Promise.all(captures.map(reduireImage));
        const repartition = repartirBudget(toutes.map(base64Bytes), []);
        capturesB64 = repartition.capturesGardees.map((i) => toutes[i] as string);
        ecartees += repartition.capturesEcartees;
      }

      // 2. La vidéo se sert sur le reliquat.
      if (fichier) {
        const utilise = capturesB64.reduce((somme, c) => somme + base64Bytes(c), 0);
        setPhase({ kind: "lecture", done: 0, total: 0 });
        const capture = await captureFrames(
          fichier,
          (done, total) => setPhase({ kind: "lecture", done, total }),
          MAX_TOTAL_BASE64_BYTES - utilise,
        );
        frames = capture.frames;
        ecartees += capture.dropped;
      }

      setPhase({ kind: "analyse" });
      const res = await parseRecipeFromVideo({
        frames,
        captures: capturesB64,
        caption: description,
        sourceUrl: lien.trim() || null,
      });
      if (!res.ok || !res.recipe) {
        setError(res.ok ? "Rien à valider." : res.error);
        return;
      }
      setLu({ frames: frames.length, captures: capturesB64.length, ecartees });
      setPreview(res.recipe);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPhase({ kind: "idle" });
    }
  };

  // Partage Android : on enchaîne sans faire retaper quoi que ce soit. Le garde `dejaLance`
  // tient le double-rendu de StrictMode comme un re-rendu de parent — relancer coûterait un
  // second appel LLM pour le même contenu.
  useEffect(() => {
    if (!demarrerAuto || dejaLance.current) return;
    dejaLance.current = true;
    void analyser();
    // `analyser` est recréé à chaque rendu ; le garde ci-dessus est ce qui borne l'exécution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demarrerAuto]);

  if (preview) {
    return (
      <RecipeDraftEditor
        preview={preview}
        onCancel={reset}
        hint={
          <p className="text-xs text-stone-500">
            {lu ? `${resumeSources(lu, description)}. ` : ""}
            Une publication annonce rarement les quantités exactes : relis chaque ligne, c’est
            ce que tu valides qui est enregistré.
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
          Dépose la vidéo, des captures d’écran de la légende, colle le texte — ou tout à la
          fois. Tout est lu dans ton navigateur : rien n’est envoyé tel quel.
        </p>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-stone-500">Lien de la publication (facultatif)</span>
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

      <div className="text-sm">
        <span className="mb-1 block text-stone-500">
          Captures d’écran de la légende (quand le texte ne se copie pas)
        </span>
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => setCaptures(Array.from(e.target.files ?? []))}
          disabled={busy}
          className="w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-1 file:text-sm dark:border-stone-700 dark:bg-stone-900 dark:file:bg-stone-800"
        />
        {captures.length > 0 && (
          <p className="mt-1 text-xs text-stone-500">
            {captures.length} capture(s) — le texte y sera lu.
          </p>
        )}
      </div>

      <div className="text-sm">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-stone-500">Description publiée</span>
          <button
            type="button"
            onClick={() => void collerDescription()}
            disabled={busy}
            className="rounded-lg border border-stone-300 px-3 py-1 text-xs font-medium disabled:opacity-50 dark:border-stone-700"
          >
            Coller
          </button>
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          placeholder="Appui long sur la légende du reel → Copier, puis « Coller » ici."
          disabled={busy}
          className="w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
        />
      </div>

      <button
        type="submit"
        disabled={busy || !pretAAnalyser}
        className="w-full rounded-xl px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: "var(--accent)" }}
      >
        {busy ? "Analyse…" : "Analyser"}
      </button>

      {phase.kind === "captures" && (
        <p className="text-xs text-stone-500">Préparation des captures d’écran…</p>
      )}
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

/** Dit ce qui a RÉELLEMENT servi à l'extraction — y compris ce qui a été écarté. */
function resumeSources(lu: Lu, description: string): string {
  const parts: string[] = [];
  if (lu.captures > 0) parts.push(`${lu.captures} capture(s) d’écran lue(s)`);
  if (lu.frames > 0) parts.push(`${lu.frames} image(s) de la vidéo`);
  if (description.trim()) parts.push("description collée");
  const base = parts.length > 0 ? `Sources : ${parts.join(" + ")}` : "Aucune source d’image";
  return lu.ecartees > 0 ? `${base} (${lu.ecartees} écartée(s), trop lourdes)` : base;
}
