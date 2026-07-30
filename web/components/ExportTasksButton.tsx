"use client";

// Bouton « Envoyer vers Google Tasks » : crée une NOUVELLE liste cochable dans Google Tasks
// (un groupe par batch), sur le compte Google de Marc. La création se fait côté serveur
// (Server Action) avec le jeton Google de la session.

import { useState, useTransition } from "react";
import { exportBatchToTasks } from "@/lib/actions";

export function ExportTasksButton({ batchId }: { batchId: number }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      setMsg(null);
      const res = await exportBatchToTasks(batchId);
      if (!res.ok) {
        setMsg({ ok: false, text: res.error });
        return;
      }
      setMsg({
        ok: true,
        text: `Liste créée dans Google Tasks (${res.count ?? 0} article${(res.count ?? 0) > 1 ? "s" : ""}). Ouvre l'app Google Tasks pour la cocher.`,
      });
    });

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="w-full rounded-xl px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: "var(--accent)" }}
      >
        {pending ? "Création dans Google Tasks…" : "Envoyer vers Google Tasks (liste cochable)"}
      </button>
      {msg && (
        <p
          className={`text-center text-xs ${
            msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
          }`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
