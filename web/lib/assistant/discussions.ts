// lib/assistant/discussions.ts — les discussions de l'atelier, gardées par la page (fonctions pures + un petit état).
//
// lia-ui ne garde rien : l'hôte tient la liste (`historique.liste`), rouvre une discussion (`ouvrir`) et en commence une
// (`nouveau`). Ici : en mémoire de la page, comme l'ancien chat (il n'écrivait rien non plus) ; recharger la page repart de zéro.
// Aucune base, donc aucune donnée de Marc à protéger de plus. Ce que dit une discussion est une DONNÉE pour le modèle.

import { MAX_MESSAGES_HISTORIQUE, type Message } from "./protocole";

interface Discussion {
  id: string;
  titre: string;
  messages: Message[];
}

/** Ce que lia-ui affiche : `moi` pour Marc, `lia` pour l'assistant. */
interface MessageAtelier {
  de: "lia" | "moi";
  texte: string;
}

const TITRE_MAX = 60;

/** Le titre d'une discussion : sa première question, coupée. */
export function titreDe(question: string): string {
  const propre = question.replace(/\s+/g, " ").trim();
  return propre.length > TITRE_MAX ? `${propre.slice(0, TITRE_MAX - 1)}…` : propre || "Discussion";
}

function versMessagesLia(messages: readonly Message[]): MessageAtelier[] {
  return messages.map((m) => ({ de: m.role === "user" ? "moi" : "lia", texte: m.contenu }));
}

/** L'historique envoyé avec une question : les derniers messages seulement (le serveur tronque aussi). */
export function historiqueEnvoye(messages: readonly Message[]): Message[] {
  return messages.slice(-MAX_MESSAGES_HISTORIQUE);
}

export interface Discussions {
  /** Les messages de la discussion en cours (avant la question qu'on va poser). */
  courante(): readonly Message[];
  /** Note un échange réussi dans la discussion en cours (la crée à la première question). */
  noter(question: string, reponse: string): void;
  /** Les discussions non vides, la plus récente d'abord. */
  liste(): Array<{ id: string; titre: string }>;
  /** Rouvre une discussion et rend ses messages ; une inconnue rend une liste vide (rien n'est inventé). */
  ouvrir(id: string): MessageAtelier[];
  /** Repart d'une discussion vide ; l'ancienne reste dans la liste. */
  nouveau(): void;
}

export function creerDiscussions(nouvelId: () => string = () => crypto.randomUUID()): Discussions {
  const toutes: Discussion[] = [];
  let courante: Discussion | null = null;

  return {
    courante: () => courante?.messages ?? [],
    noter(question, reponse) {
      if (!courante) {
        courante = { id: nouvelId(), titre: titreDe(question), messages: [] };
        toutes.push(courante);
      }
      courante.messages = [...courante.messages, { role: "user", contenu: question }, { role: "assistant", contenu: reponse }];
    },
    liste: () => [...toutes].reverse().map(({ id, titre }) => ({ id, titre })),
    ouvrir(id) {
      const trouvee = toutes.find((d) => d.id === id);
      if (!trouvee) return [];
      courante = trouvee;
      return versMessagesLia(trouvee.messages);
    },
    nouveau() {
      courante = null;
    },
  };
}
