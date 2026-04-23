"use client";

import { useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Floating "Chef" assistant button.
 *
 * Phase 1 (now): visual-only. Click opens a small placeholder drawer saying
 * "Chef AI arrive bientôt" so the user can see where the feature will live.
 *
 * Phase 3 (future): real drawer with chat, suggestions ("t'as plus d'huile
 * d'olive"), 1-click actions ("générer un batch équilibré").
 */
export function ChefFab() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* FAB — sits above the bottom nav on mobile, bottom-right on desktop */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Ouvrir le chef assistant"
        className={cn(
          "fixed z-40 right-4 md:right-6",
          // On mobile, lift above the 64px bottom nav + safe area
          "bottom-[calc(theme(spacing.16)+env(safe-area-inset-bottom)+theme(spacing.4))] md:bottom-6",
          "flex h-14 w-14 items-center justify-center rounded-full",
          "bg-gradient-to-br from-primary to-secondary text-primary-foreground",
          "shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all",
        )}
      >
        <MessageCircle className="h-6 w-6" />
      </button>

      {/* Drawer — very minimal for Phase 1 */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm md:hidden"
            onClick={() => setOpen(false)}
          />
          <aside
            className={cn(
              "fixed z-50 bg-card border-border",
              // Mobile : full-width bottom sheet
              "inset-x-0 bottom-0 rounded-t-2xl border-t",
              // Desktop : right-side drawer
              "md:inset-auto md:right-6 md:bottom-24 md:top-auto md:w-96 md:rounded-2xl md:border md:shadow-2xl",
            )}
          >
            <header className="flex items-center justify-between px-4 py-3 border-b">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-secondary text-primary-foreground">
                  <MessageCircle className="h-4 w-4" />
                </div>
                <div>
                  <p className="title-serif font-bold text-sm leading-tight">Chef</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">Assistant IA</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Fermer"
                className="h-8 w-8 rounded-md hover:bg-accent/60 inline-flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="p-4 space-y-3 text-sm">
              <p className="text-muted-foreground">
                Le Chef arrive bientôt. Il pourra&nbsp;:
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex gap-2">
                  <span>🗓</span>
                  <span>Proposer un batch équilibré pour la semaine</span>
                </li>
                <li className="flex gap-2">
                  <span>🛒</span>
                  <span>Suggérer des remplacements selon ton frigo</span>
                </li>
                <li className="flex gap-2">
                  <span>💡</span>
                  <span>Répondre à tes questions de cuisine en français</span>
                </li>
              </ul>
              <div className="mt-4 rounded-lg bg-muted p-3 text-xs text-muted-foreground italic">
                «&nbsp;Propose-moi 3 recettes légères pour la semaine prochaine&nbsp;»
                <br />
                <span className="opacity-60">&mdash; exemple de ce que tu pourras demander</span>
              </div>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
