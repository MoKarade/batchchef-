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
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Assistant</h1>
        <p className="mt-1 text-sm doux">
          Il fouille tes recettes et le catalogue pour répondre. Il dit toujours d’où vient ce
          qu’il propose.
        </p>
      </div>
      <Conversation configure={Boolean(process.env.ANTHROPIC_API_KEY)} />
    </div>
  );
}
