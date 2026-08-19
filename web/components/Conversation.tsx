"use client";

// L'écran de conversation. Volontairement simple : une liste de messages, un champ, un envoi.
//
// Deux choix qui comptent pour l'honnêteté de l'écran :
//  - la question de Marc s'affiche IMMÉDIATEMENT, mais la réponse n'apparaît que quand elle
//    existe vraiment — aucun texte n'est fabriqué en attendant ;
//  - un échec laisse la question EN PLACE dans le champ. Perdre ce que quelqu'un vient
//    d'écrire parce que le réseau a coupé est la faute la plus agaçante d'un chat.

import { useRef, useState, useTransition } from "react";
import { demanderAAssistant } from "@/lib/actions";
import { MAX_CARACTERES_MESSAGE, type Message } from "@/lib/assistant/protocole";

const EXEMPLES = [
  "Qu'est-ce que je peux faire avec du poulet, du riz et des brocolis ?",
  "Je n'ai pas de crème 35 %, je remplace par quoi ?",
  "Compose-moi une recette de batch pour 8 portions à partir de ce que tu trouves.",
];

export function Conversation({ configure }: { configure: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [saisie, setSaisie] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const champ = useRef<HTMLTextAreaElement>(null);

  const envoyer = (texte: string) => {
    const question = texte.trim();
    if (!question || pending) return;
    setErreur(null);
    const suite: Message[] = [...messages, { role: "user", contenu: question }];
    setMessages(suite);
    setSaisie("");
    startTransition(async () => {
      const res = await demanderAAssistant(suite);
      if (!res.ok) {
        setErreur(res.error);
        // La question retourne dans le champ : elle n'est pas perdue.
        setMessages(messages);
        setSaisie(question);
        champ.current?.focus();
        return;
      }
      setMessages([...suite, { role: "assistant", contenu: res.texte ?? "" }]);
    });
  };

  if (!configure) {
    return (
      <p className="rounded-lg alerte p-3 text-sm">
        L’assistant n’est pas configuré : il manque <code>ANTHROPIC_API_KEY</code> côté serveur.
        Ce n’est pas une panne, l’intégration est simplement éteinte.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {messages.length === 0 && (
        <div className="space-y-2">
          <p className="text-sm doux">Par exemple :</p>
          <ul className="space-y-2">
            {EXEMPLES.map((ex) => (
              <li key={ex}>
                <button
                  type="button"
                  onClick={() => envoyer(ex)}
                  disabled={pending}
                  className="w-full rounded-xl border border-[var(--bordure)] px-4 py-3 text-left text-sm disabled:opacity-60"
                >
                  {ex}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="space-y-3">
        {messages.map((m, i) => (
          <li
            key={i}
            className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] rounded-2xl px-4 py-3 text-sm sur-accent"
                  : "max-w-[85%] whitespace-pre-line carte px-4 py-3 text-sm leading-relaxed"
              }
              style={m.role === "user" ? { backgroundColor: "var(--accent)" } : undefined}
            >
              {m.contenu}
            </div>
          </li>
        ))}
        {pending && (
          <li className="flex justify-start">
            <p className="carte px-4 py-3 text-sm doux">Je cherche dans ta base…</p>
          </li>
        )}
      </ul>

      {erreur && <p className="rounded-lg erreur p-3 text-sm">{erreur}</p>}

      <div className="sticky bottom-20 space-y-2 sm:bottom-4">
        <textarea
          ref={champ}
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          maxLength={MAX_CARACTERES_MESSAGE}
          rows={3}
          placeholder="Ce que tu as sous la main, ou ce que tu cherches…"
          disabled={pending}
          className="champ text-sm"
        />
        <button
          type="button"
          onClick={() => envoyer(saisie)}
          disabled={pending || saisie.trim().length === 0}
          className="bouton bouton-principal w-full"
        >
          {pending ? "Recherche en cours…" : "Demander"}
        </button>
      </div>
    </div>
  );
}
