// La boucle agentique : Claude interroge la base jusqu'à pouvoir répondre.
//
// Server-side only. Chaque appel est comptabilisé (`recordLlmUsage`) — le coût par question
// est plus élevé qu'un appel unique, et un coût qu'on ne mesure pas est un coût qu'on
// découvre sur la facture.

import Anthropic from "@anthropic-ai/sdk";
import { recordLlmUsage } from "@/lib/llmUsage";
import {
  BUDGET_MS,
  MAX_TOURS_OUTILS,
  promptSysteme,
  tronquerHistorique,
  type Message,
} from "./protocole";
import { OUTILS, compterCatalogue, executerOutil } from "./outils";

const MODELE = process.env.BATCHCHEF_MODELE_ASSISTANT ?? "claude-sonnet-5";

export interface ReponseAssistant {
  ok: boolean;
  texte: string;
  /** Nombre d'allers-retours d'outils réellement faits — affiché, jamais deviné. */
  toursOutils: number;
  /** `true` si la borne a été atteinte : la réponse est PARTIELLE et le dit. */
  borneAtteinte: boolean;
  /** `true` si le modèle a été coupé par le plafond de jetons — la phrase s'arrête net. */
  coupeeEnCours: boolean;
}

type BlocContenu = Anthropic.Messages.ContentBlockParam;

export async function repondre(historique: readonly Message[]): Promise<ReponseAssistant> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Intégration ÉTEINTE, à distinguer d'une panne : les confondre les rendrait invisibles.
    return {
      ok: false,
      texte: "L'assistant n'est pas configuré (clé API absente).",
      toursOutils: 0,
      borneAtteinte: false,
      coupeeEnCours: false,
    };
  }
  const client = new Anthropic({ apiKey });
  // ⚠️ Le prompt annonce la taille du catalogue, et ce nombre est LU, jamais écrit : il
  // partait à un modèle qui pouvait le répéter à Marc comme un fait. Un compte
  // indisponible ne s'invente pas — `null` fait dire « plusieurs milliers ». Et la panne
  // ne reste pas cachée : si la base est vraiment tombée, le premier appel d'outil le dira.
  const nbCatalogue = await compterCatalogue();
  const systeme = promptSysteme(nbCatalogue);

  const messages: Anthropic.Messages.MessageParam[] = tronquerHistorique(historique).map((m) => ({
    role: m.role,
    content: m.contenu,
  }));

  const debut = Date.now();
  let tours = 0;
  let budgetEpuise = false;
  while (tours <= MAX_TOURS_OUTILS) {
    const reponse = await client.messages.create({
      model: MODELE,
      max_tokens: 2000,
      system: systeme,
      tools: OUTILS as unknown as Anthropic.Messages.Tool[],
      messages,
    });
    await recordLlmUsage("assistant", reponse.usage, MODELE);

    const demandes = reponse.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );

    if (demandes.length === 0) {
      const texte = reponse.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      // ⚠️ Une réponse coupée par le plafond de jetons s'arrête EN PLEIN MILIEU d'une
      // phrase. Rendue telle quelle, elle a l'air complète : Marc lirait une recette dont
      // la dernière étape manque sans rien pour le lui dire. On l'annonce.
      const coupee = reponse.stop_reason === "max_tokens";
      return {
        ok: true,
        texte:
          (texte || "Je n'ai pas trouvé quoi répondre.") +
          (coupee ? "\n\n[Réponse coupée : elle était trop longue. Demande-moi la suite.]" : ""),
        toursOutils: tours,
        borneAtteinte: false,
        coupeeEnCours: coupee,
      };
    }

    if (tours === MAX_TOURS_OUTILS) break;
    // Le mur de la plateforme arrive avant la borne de tours quand les appels traînent :
    // s'arrêter ici laisse une réponse honnête, aller plus loin donne une erreur illisible.
    if (Date.now() - debut > BUDGET_MS) {
      budgetEpuise = true;
      break;
    }

    messages.push({ role: "assistant", content: reponse.content });
    const resultats: BlocContenu[] = [];
    for (const demande of demandes) {
      const sortie = await executerOutil(
        demande.name,
        (demande.input ?? {}) as Record<string, unknown>,
      );
      resultats.push({ type: "tool_result", tool_use_id: demande.id, content: sortie });
    }
    messages.push({ role: "user", content: resultats });
    tours += 1;
  }

  // Borne atteinte : ce n'est pas une erreur, c'est une réponse qu'on n'a pas pu finir.
  // Le dire vaut mieux qu'un texte tronqué qui aurait l'air complet. Et on distingue les
  // deux causes : « je n'ai pas trouvé » et « je n'ai pas eu le temps » n'appellent pas la
  // même chose de la part de Marc.
  return {
    ok: true,
    texte: budgetEpuise
      ? "J'ai manqué de temps avant d'aboutir (la recherche a été longue). Repose ta " +
        "question — souvent le deuxième essai passe, la base répondant plus vite."
      : `J'ai cherché ${MAX_TOURS_OUTILS} fois dans la base sans arriver à conclure. ` +
        "Reformule en précisant (un ingrédient principal, un type de plat) — je repartirai de là.",
    toursOutils: tours,
    borneAtteinte: true,
    coupeeEnCours: false,
  };
}
