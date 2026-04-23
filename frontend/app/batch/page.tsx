"use client";

import { useState } from "react";
import { Sparkles, ShoppingBasket } from "lucide-react";
import { CartPage } from "@/components/features/CartPage";
import { AutoBatchPage } from "@/components/features/AutoBatchPage";
import { useCart } from "@/lib/cart";

/**
 * /batch — unified batch building surface. Two modes in tabs:
 *   - Auto   : backend proposes a batch based on filters + inventory
 *   - Manuel : you pick recipes via + buttons (Panier cart)
 *
 * Whichever mode the user lands in, the final action is the same:
 * persist the real batch via /api/batches/generate and redirect to
 * /batches/{id} for the detail view + shopping list.
 */
export default function Page() {
  const { count: cartCount } = useCart();
  // Default to Manuel when the cart already has items, otherwise Auto
  // (so new users land on the AI-assist path).
  const [mode, setMode] = useState<"auto" | "manuel">(cartCount > 0 ? "manuel" : "auto");

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="title-serif text-3xl font-bold">Créer un batch</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Auto = je propose · Manuel = tu choisis
          </p>
        </div>
      </header>

      {/* Mode tabs */}
      <div className="inline-flex rounded-full border border-border bg-card p-1">
        <button
          onClick={() => setMode("auto")}
          className={`inline-flex items-center gap-2 rounded-full px-4 h-9 text-sm font-medium transition-colors ${
            mode === "auto"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Auto
        </button>
        <button
          onClick={() => setMode("manuel")}
          className={`relative inline-flex items-center gap-2 rounded-full px-4 h-9 text-sm font-medium transition-colors ${
            mode === "manuel"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ShoppingBasket className="h-3.5 w-3.5" />
          Manuel
          {cartCount > 0 && (
            <span
              className={`ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                mode === "manuel"
                  ? "bg-primary-foreground text-primary"
                  : "bg-primary text-primary-foreground"
              }`}
            >
              {cartCount}
            </span>
          )}
        </button>
      </div>

      {mode === "auto" ? <AutoBatchPage /> : <CartPage />}
    </div>
  );
}
