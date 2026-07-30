"use client";

// Bouton « Partager la liste » : ouvre le menu de partage de l'appareil (Web Share API).
// Sur téléphone → tu tapes Google Keep → la liste devient une note Keep dans ton compte.
// (Google Keep n'a pas d'API pour les comptes perso : le partage système est la bonne voie.)
// Repli sans Web Share (ordi) : copie dans le presse-papier.

import { useState } from "react";
import { formatQty } from "@/lib/aggregate";

interface Item {
  name: string;
  qty: number | null;
  unit: "g" | "ml" | "unite" | null;
  checked: boolean;
}

/** Texte de la liste : titre + un article par ligne (seulement ce qui reste à acheter). */
export function buildText(batchName: string, items: Item[]): { title: string; body: string } | null {
  const remaining = items.filter((i) => !i.checked);
  const list = remaining.length > 0 ? remaining : items;
  if (list.length === 0) return null;
  const title = `Épicerie — ${batchName}`;
  const lines = list.map((i) => {
    const qty = i.qty !== null ? ` — ${formatQty(i.qty, i.unit)}` : "";
    return `- ${i.name}${qty}`;
  });
  return { title, body: `${title}\n${lines.join("\n")}` };
}

export function ShareListButton({ batchName, items }: { batchName: string; items: Item[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const payload = buildText(batchName, items);
  if (!payload) return null;

  const share = async () => {
    setMsg(null);
    const copie = async () => {
      try {
        await navigator.clipboard.writeText(payload.body);
        setMsg("Liste copiée — colle-la dans Keep.");
      } catch {
        setMsg("Partage indisponible sur cet appareil.");
      }
    };
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: payload.title, text: payload.body });
      } catch (err) {
        // L'utilisateur a fermé le menu de partage : ce n'est pas une erreur.
        if (err instanceof Error && err.name === "AbortError") return;
        await copie();
      }
      return;
    }
    await copie();
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={share}
        className="w-full rounded-xl border px-4 py-3 text-sm font-medium"
        style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
      >
        Partager la liste (Keep, Notes…)
      </button>
      {msg && <p className="text-center text-xs text-stone-500">{msg}</p>}
    </div>
  );
}
