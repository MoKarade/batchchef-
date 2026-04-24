"use client";

import { useState, useCallback } from "react";
import { AlertTriangle, X } from "lucide-react";

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

/**
 * Imperative confirm() replacement — `useConfirm()` gives back a `confirm`
 * function that returns a Promise<boolean>.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   if (await confirm({ title: "Supprimer ce batch ?", destructive: true })) {
 *     deleteMut.mutate();
 *   }
 */
export function useConfirm() {
  const [state, setState] = useState<{
    opts: ConfirmOptions;
    resolve: (v: boolean) => void;
  } | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setState({ opts, resolve })),
    [],
  );

  const dialog = state && (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={() => {
        state.resolve(false);
        setState(null);
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-background border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="p-5 flex items-start gap-3">
          <div
            className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
              state.opts.destructive
                ? "bg-destructive/15 text-destructive"
                : "bg-primary/15 text-primary"
            }`}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="title-serif font-bold">{state.opts.title}</h3>
            {state.opts.message && (
              <p className="text-sm text-muted-foreground mt-1">{state.opts.message}</p>
            )}
          </div>
          <button
            onClick={() => {
              state.resolve(false);
              setState(null);
            }}
            className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center"
            aria-label="Fermer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>
        <footer className="p-3 bg-muted/30 border-t flex justify-end gap-2 rounded-b-2xl">
          <button
            onClick={() => {
              state.resolve(false);
              setState(null);
            }}
            className="h-9 px-3 rounded-lg border bg-background text-sm font-medium hover:bg-accent"
          >
            {state.opts.cancelLabel ?? "Annuler"}
          </button>
          <button
            onClick={() => {
              state.resolve(true);
              setState(null);
            }}
            className={`h-9 px-4 rounded-lg text-sm font-semibold shadow ${
              state.opts.destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            }`}
          >
            {state.opts.confirmLabel ??
              (state.opts.destructive ? "Supprimer" : "Confirmer")}
          </button>
        </footer>
      </div>
    </div>
  );

  return { confirm, dialog };
}
