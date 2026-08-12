// /partage — cible du partage Android (Web Share Target, cf. public/manifest.webmanifest).
//
// Le POST du partage est intercepté par le service worker, qui range le contenu dans le
// Cache Storage puis redirige ici en GET. Cette page ne reçoit donc jamais la vidéo : c'est
// le composant client qui la relit localement.
//
// Elle reste DERRIÈRE le middleware d'auth comme toute page qui affiche des données.

import { PartageClient } from "@/components/PartageClient";

export const dynamic = "force-dynamic";
// Même raison que /recettes : l'analyse enchaîne deux appels LLM.
export const maxDuration = 60;

export default async function PartagePage({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string }>;
}) {
  const { erreur } = await searchParams;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Recette partagée</h1>
        <p className="mt-1 text-sm text-stone-500">
          Vérifie l’extraction avant d’enregistrer — c’est ce que tu valides qui entre dans ta
          bibliothèque.
        </p>
      </div>
      <PartageClient erreurWorker={erreur === "1"} />
    </div>
  );
}
