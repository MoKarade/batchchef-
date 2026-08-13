"use client";

// Reçoit ce qu'Android vient de partager. Le service worker a déposé la vidéo et le texte
// dans le Cache Storage (cf. public/sw.js) ; on les relit ICI, dans le navigateur, et on
// les passe au formulaire d'import — la vidéo ne transite donc jamais par le serveur.
//
// Marc a choisi de GARDER l'écran de validation : le partage enchaîne l'analyse tout seul,
// mais rien n'entre en base avant qu'il ait relu.

import { useEffect, useState } from "react";
import { ImportVideoForm } from "@/components/ImportVideoForm";
import {
  CACHE_PARTAGE,
  CLE_META,
  CLE_VIDEO,
  normaliserPartage,
  type PartageNormalise,
} from "@/lib/partage";

interface Recu extends PartageNormalise {
  fichier: File | null;
  captures: File[];
  /** Champs BRUTS transmis par Android, tels quels — voir `DiagnosticPartage`. */
  brut: { titre: string; texte: string; url: string };
}

type Etat =
  | { kind: "chargement" }
  | { kind: "pret"; recu: Recu }
  | { kind: "vide"; motif: string };

export function PartageClient({ erreurWorker }: { erreurWorker: boolean }) {
  const [etat, setEtat] = useState<Etat>({ kind: "chargement" });

  useEffect(() => {
    let annule = false;

    (async () => {
      if (erreurWorker) {
        setEtat({ kind: "vide", motif: "Le partage n'a pas pu être enregistré par l'app." });
        return;
      }
      if (typeof caches === "undefined") {
        setEtat({ kind: "vide", motif: "Ce navigateur ne sait pas recevoir de partage." });
        return;
      }

      try {
        const cache = await caches.open(CACHE_PARTAGE);
        const reponseMeta = await cache.match(CLE_META);
        if (!reponseMeta) {
          setEtat({ kind: "vide", motif: "Rien à récupérer : ce partage a déjà été traité." });
          return;
        }

        const meta = (await reponseMeta.json()) as {
          titre?: string;
          texte?: string;
          url?: string;
          aVideo?: boolean;
          nom?: string;
          type?: string;
          captures?: { cle: string; nom: string; type: string }[];
        };

        let fichier: File | null = null;
        if (meta.aVideo) {
          const reponseVideo = await cache.match(CLE_VIDEO);
          if (reponseVideo) {
            const blob = await reponseVideo.blob();
            fichier = new File([blob], meta.nom || "video.mp4", {
              type: meta.type || blob.type || "video/mp4",
            });
          }
        }

        const captures: File[] = [];
        for (const decrite of meta.captures ?? []) {
          const reponse = await cache.match(decrite.cle);
          if (!reponse) continue;
          const blob = await reponse.blob();
          captures.push(
            new File([blob], decrite.nom, { type: decrite.type || blob.type || "image/jpeg" }),
          );
        }

        // Consommé : on vide, sinon un rechargement de page relancerait une analyse
        // (et un appel LLM) sur un partage déjà traité.
        await cache.delete(CLE_META);
        await cache.delete(CLE_VIDEO);
        for (const decrite of meta.captures ?? []) await cache.delete(decrite.cle);

        if (annule) return;
        const brut = {
          titre: meta.titre ?? "",
          texte: meta.texte ?? "",
          url: meta.url ?? "",
        };
        const { lien, description } = normaliserPartage(brut);
        setEtat({ kind: "pret", recu: { lien, description, fichier, captures, brut } });
      } catch (err) {
        if (annule) return;
        setEtat({
          kind: "vide",
          motif: err instanceof Error ? err.message : "Lecture du partage impossible.",
        });
      }
    })();

    return () => {
      annule = true;
    };
  }, [erreurWorker]);

  if (etat.kind === "chargement") {
    return <p className="text-sm text-stone-500">Récupération du partage…</p>;
  }

  if (etat.kind === "vide") {
    return (
      <div className="space-y-3">
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {etat.motif} Tu peux quand même déposer la vidéo ou coller la description ci-dessous.
        </p>
        <ImportVideoForm />
      </div>
    );
  }

  const { recu } = etat;
  const aDesImages = Boolean(recu.fichier) || recu.captures.length > 0;
  const sansContenu = !aDesImages && recu.description.trim().length === 0;

  return (
    <div className="space-y-3">
      {sansContenu && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">Instagram n’a partagé que le lien.</p>
          <p className="mt-1">
            Ni la vidéo, ni la légende : c’est sa limite, et elle vaut pour toute app. Deux
            façons de donner le contenu à BatchChef :
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              <strong>Captures d’écran</strong> — capture la légende, et les moments de la vidéo
              où les quantités s’affichent. Partage-les depuis la Galerie (ou la notification de
              capture) : le texte y sera lu.
            </li>
            <li>
              <strong>Copier la légende</strong> — appui long sur le texte du reel → Copier, puis
              le bouton « Coller » ci-dessous.
            </li>
          </ol>
        </div>
      )}
      <ImportVideoForm
        lienInitial={recu.lien ?? ""}
        descriptionInitiale={recu.description}
        fichierInitial={recu.fichier}
        capturesInitiales={recu.captures}
        demarrerAuto={aDesImages}
      />
      <DiagnosticPartage brut={recu.brut} fichier={recu.fichier} captures={recu.captures} />
    </div>
  );
}

/**
 * Ce que l'app source a RÉELLEMENT transmis, champ par champ.
 *
 * Ce que chaque app met dans un partage Android n'est écrit nulle part et varie d'une app à
 * l'autre : le supposer conduit à débattre au lieu de mesurer. Ce bloc rend la question
 * tranchable en un partage — et il parle même quand tout est vide, parce qu'un diagnostic
 * muet ne distingue pas « rien reçu » de « pas branché ».
 */
function DiagnosticPartage({
  brut,
  fichier,
  captures,
}: {
  brut: { titre: string; texte: string; url: string };
  fichier: File | null;
  captures: File[];
}) {
  const lignes: [string, string][] = [
    ["title", brut.titre || "— (vide)"],
    ["text", brut.texte || "— (vide)"],
    ["url", brut.url || "— (vide)"],
    [
      "vidéo",
      fichier
        ? `${fichier.name} · ${fichier.type || "type inconnu"} · ${(fichier.size / 1_000_000).toFixed(1)} Mo`
        : "— (aucune vidéo partagée)",
    ],
    [
      "images",
      captures.length > 0
        ? captures.map((c) => `${c.name} · ${c.type || "type inconnu"}`).join("\n")
        : "— (aucune image partagée)",
    ],
  ];

  return (
    <details className="rounded-xl border border-stone-200 p-3 text-sm dark:border-stone-800">
      <summary className="cursor-pointer text-stone-500">Ce que le partage a transmis</summary>
      <dl className="mt-2 space-y-2">
        {lignes.map(([cle, valeur]) => (
          <div key={cle}>
            <dt className="text-xs font-medium text-stone-500">{cle}</dt>
            <dd className="break-words whitespace-pre-wrap">{valeur}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-stone-500">
        C’est l’app source (Instagram, Galerie…) qui décide de ce qu’elle met ici. BatchChef
        n’a accès à rien d’autre.
      </p>
    </details>
  );
}
