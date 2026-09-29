// /assistant — poser une question à Claude sur SA base de recettes.
//
// Trois usages demandés par Marc : quoi cuisiner avec ce qu'il a (même incomplet), trouver
// des équivalents d'ingrédients, et composer une recette en s'appuyant sur toute la base.

import { Conversation } from "@/components/Conversation";

export const dynamic = "force-dynamic";
// La boucle enchaîne plusieurs appels LLM : le défaut de la plateforme couperait au milieu.
export const maxDuration = 60;

export default function AssistantPage() {
  return (
    <div>
      <header className="entete">
        <div>
          <p className="surtitre">Cuisine</p>
          <h1>Assistant</h1>
          <p className="doux mt-1">
            Il fouille tes recettes et le catalogue pour répondre. Il dit toujours d’où vient ce
            qu’il propose.
          </p>
        </div>
      </header>
      <Conversation configure={Boolean(process.env.ANTHROPIC_API_KEY)} />
    </div>
  );
}
