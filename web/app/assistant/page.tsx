// /assistant — poser une question à LIA sur SA base de recettes (LIA en pleine page : son interface, son corps).
//
// Trois usages demandés par Marc : quoi cuisiner avec ce qu'il a (même incomplet), trouver
// des équivalents d'ingrédients, et composer une recette en s'appuyant sur toute la base.
// L'ancien chat est remplacé par l'atelier de LIA (tâche #346) ; le moteur est resté le même.

import { AtelierLia } from "@/components/AtelierLia";

export const dynamic = "force-dynamic";
// La boucle enchaîne plusieurs appels LLM (`/api/lia/ask` déclare ses 60 s aussi) : le défaut de la plateforme couperait au milieu.
export const maxDuration = 60;

export default function AssistantPage() {
  return (
    <div>
      <header className="entete">
        <div>
          <p className="surtitre">Cuisine</p>
          <h1>Assistant</h1>
          <p className="doux mt-1">
            LIA fouille tes recettes et le catalogue pour répondre. Elle dit toujours d’où vient ce
            qu’elle propose.
          </p>
        </div>
      </header>
      <AtelierLia configure={Boolean(process.env.ANTHROPIC_API_KEY)} />
    </div>
  );
}
