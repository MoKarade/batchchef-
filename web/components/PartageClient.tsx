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

        // Consommé : on vide, sinon un rechargement de page relancerait une analyse
        // (et un appel LLM) sur un partage déjà traité.
        await cache.delete(CLE_META);
        await cache.delete(CLE_VIDEO);

        if (annule) return;
        const { lien, description } = normaliserPartage({
          titre: meta.titre,
          texte: meta.texte,
          url: meta.url,
        });
        setEtat({ kind: "pret", recu: { lien, description, fichier } });
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
  const sansContenu = !recu.fichier && recu.description.trim().length === 0;

  return (
    <div className="space-y-3">
      {sansContenu && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Instagram n’a partagé que le lien — ni la vidéo, ni la légende. C’est sa limite, pas
          celle de BatchChef : reviens sur le reel, appuie longuement sur la description pour
          la copier, et colle-la ici. Ou enregistre la vidéo puis repartage-la depuis la
          galerie.
        </p>
      )}
      <ImportVideoForm
        lienInitial={recu.lien ?? ""}
        descriptionInitiale={recu.description}
        fichierInitial={recu.fichier}
        demarrerAuto={Boolean(recu.fichier)}
      />
    </div>
  );
}
