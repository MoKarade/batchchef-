"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MessageCircle, X, Send, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { chefApi, type ChefChatMessage } from "@/lib/api";
import { useCart } from "@/lib/cart";

/**
 * Phase 3 — the Chef drawer is now a real chat bound to /api/chef/chat.
 *
 * Message history lives in localStorage so the conversation survives a
 * page reload. The backend builds its context (inventory, recipes,
 * mapped-parent count) each call, so Chef always speaks from fresh data.
 *
 * Future nice-to-haves (not in this MVP):
 *   - Function-calling so Chef can directly add a recipe to the cart
 *   - Streaming reply (currently we wait for the full response)
 *   - "Rebuild batch from this conversation" action
 */

const STORAGE_KEY = "batchchef.chef.v1";
const STARTER_SUGGESTIONS = [
  "Propose-moi 3 recettes rapides pour cette semaine",
  "Par quoi remplacer la crème 35 % ?",
  "Combien de temps garde un batch de ratatouille au frigo ?",
  "Que faire avec mes ingrédients du frigo ?",
] as const;

function loadHistory(): ChefChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(msgs: ChefChatMessage[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-40)));
}

export function ChefFab() {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<ChefChatMessage[]>([]);
  const [input, setInput] = useState("");
  const cart = useCart();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Hydrate history on first mount — keeps SSR markup deterministic.
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // Auto-scroll to bottom when new messages arrive or drawer opens.
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, open]);

  const cartTitles = useMemo(() => cart.items.map((i) => i.title), [cart.items]);

  const chat = useMutation({
    mutationFn: async (nextHistory: ChefChatMessage[]) => {
      const res = await chefApi.chat({
        messages: nextHistory,
        cart_recipes: cartTitles.length ? cartTitles : null,
      });
      return res.data.reply;
    },
    onSuccess: (reply, variables) => {
      const merged = [...variables, { role: "assistant" as const, content: reply }];
      setHistory(merged);
      saveHistory(merged);
    },
    onError: (err, variables) => {
      const merged = [
        ...variables,
        {
          role: "assistant" as const,
          content:
            "Désolé, je ne suis pas joignable pour le moment. " +
            `(${(err as Error).message || "erreur réseau"})`,
        },
      ];
      setHistory(merged);
      saveHistory(merged);
    },
  });

  const send = (text: string) => {
    const content = text.trim();
    if (!content || chat.isPending) return;
    const next: ChefChatMessage[] = [...history, { role: "user", content }];
    setHistory(next);
    saveHistory(next);
    setInput("");
    chat.mutate(next);
  };

  const clear = () => {
    if (!confirm("Effacer la conversation ?")) return;
    setHistory([]);
    saveHistory([]);
  };

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Ouvrir le chef assistant"
        className={cn(
          "fixed z-40 right-4 md:right-6",
          "bottom-[calc(theme(spacing.16)+env(safe-area-inset-bottom)+theme(spacing.4))] md:bottom-6",
          "flex h-14 w-14 items-center justify-center rounded-full",
          "bg-gradient-to-br from-primary to-secondary text-primary-foreground",
          "shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all",
        )}
      >
        <MessageCircle className="h-6 w-6" />
      </button>

      {/* Drawer */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm md:hidden"
            onClick={() => setOpen(false)}
          />
          <aside
            className={cn(
              "fixed z-50 bg-card border-border flex flex-col",
              // Mobile: 80vh bottom sheet
              "inset-x-0 bottom-0 top-[20vh] rounded-t-2xl border-t",
              // Desktop: right-side panel
              "md:inset-auto md:right-6 md:bottom-24 md:top-24 md:w-[420px] md:rounded-2xl md:border md:shadow-2xl md:top-auto md:h-[min(680px,calc(100vh-12rem))]",
            )}
          >
            {/* Header */}
            <header className="flex items-center justify-between px-4 py-3 border-b shrink-0">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-secondary text-primary-foreground">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <p className="title-serif font-bold text-sm leading-tight">Chef</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    Assistant cuisine IA
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {history.length > 0 && (
                  <button
                    onClick={clear}
                    aria-label="Effacer"
                    title="Effacer la conversation"
                    className="h-8 w-8 rounded-md hover:bg-accent/60 inline-flex items-center justify-center text-muted-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Fermer"
                  className="h-8 w-8 rounded-md hover:bg-accent/60 inline-flex items-center justify-center"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            {/* Scrollback */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
              {history.length === 0 && !chat.isPending && (
                <div className="space-y-3">
                  <div className="rounded-2xl bg-muted/60 p-3 text-xs leading-relaxed">
                    Salut&nbsp;! Je connais tes recettes, ton frigo, ton panier
                    en cours. Demande-moi ce que tu veux — j&apos;suggère des
                    recettes, je t&apos;aide à planifier ton batch, ou je te
                    donne un conseil de cuisine.
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-1">
                      Essaie
                    </p>
                    {STARTER_SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="w-full text-left text-xs px-3 py-2 rounded-lg border border-dashed border-border hover:bg-accent/40 hover:border-primary/40 transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {history.map((m, i) => (
                <ChatBubble key={i} role={m.role} content={m.content} />
              ))}

              {chat.isPending && (
                <ChatBubble role="assistant" content="…" typing />
              )}
            </div>

            {/* Composer */}
            <div className="border-t px-3 py-3 shrink-0">
              <div className="flex items-end gap-2 rounded-2xl border bg-background p-2 focus-within:ring-1 focus-within:ring-primary">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  placeholder="Pose ta question…"
                  rows={1}
                  className="flex-1 min-w-0 resize-none bg-transparent text-sm outline-none max-h-32 py-1.5 px-1"
                />
                <button
                  onClick={() => send(input)}
                  disabled={!input.trim() || chat.isPending}
                  className={cn(
                    "h-8 w-8 rounded-full inline-flex items-center justify-center shrink-0",
                    input.trim() && !chat.isPending
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
                Entrée pour envoyer · Shift+Entrée pour nouvelle ligne
              </p>
            </div>
          </aside>
        </>
      )}
    </>
  );
}

function ChatBubble({
  role,
  content,
  typing,
}: {
  role: "user" | "assistant";
  content: string;
  typing?: boolean;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-muted/60 text-foreground px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed">
        {typing ? (
          <span className="inline-flex items-center gap-1">
            <Dot /> <Dot delay={0.15} /> <Dot delay={0.3} />
          </span>
        ) : (
          content
        )}
      </div>
    </div>
  );
}

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
      style={{ animationDelay: `${delay}s` }}
    />
  );
}
