"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Loader2, Search } from "lucide-react";
import { ingredientsApi, inventoryApi, type IngredientMaster } from "@/lib/api";
import { categoryEmoji } from "@/lib/utils";

const UNITS = ["g", "kg", "ml", "l", "unite"];

export function AddInventoryItemModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<IngredientMaster | null>(null);
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("g");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: matches = [], isFetching } = useQuery({
    queryKey: ["ing-search-inv", search],
    queryFn: () => ingredientsApi.list({ search: search || undefined, limit: 20 }).then((r) => r.data),
    enabled: open && !picked,
  });

  useEffect(() => {
    if (!open) {
      setSearch("");
      setPicked(null);
      setQuantity("");
      setUnit("g");
      setExpiresAt("");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (picked?.default_unit) setUnit(picked.default_unit);
  }, [picked]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const createMut = useMutation({
    mutationFn: () => {
      const qty = parseFloat(quantity);
      if (!picked || !Number.isFinite(qty) || qty <= 0) {
        throw new Error("Renseigne un ingrédient et une quantité valide.");
      }
      return inventoryApi.create({
        ingredient_master_id: picked.id,
        quantity: qty,
        unit,
        purchased_at: new Date().toISOString(),
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message ?? "Erreur lors de l'ajout."),
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-background rounded-xl border shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold">Ajouter à l&apos;inventaire</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-md hover:bg-accent inline-flex items-center justify-center">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {!picked ? (
            <div className="space-y-2">
              <label className="text-sm font-medium">Ingrédient</label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher…"
                  className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm"
                />
              </div>
              <div className="max-h-64 overflow-y-auto border rounded-md divide-y">
                {isFetching ? (
                  <div className="p-3 text-xs text-muted-foreground text-center">
                    <Loader2 className="h-4 w-4 inline animate-spin mr-2" /> Chargement…
                  </div>
                ) : matches.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground text-center">Aucun résultat.</p>
                ) : (
                  matches.map((ing) => (
                    <button
                      key={ing.id}
                      onClick={() => setPicked(ing)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2"
                    >
                      <span>{categoryEmoji(ing.category)}</span>
                      <span className="flex-1 truncate">{ing.display_name_fr}</span>
                      {ing.category && <span className="text-xs text-muted-foreground">{ing.category}</span>}
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-md border bg-muted/40 p-3 flex items-center gap-2">
                <span className="text-xl">{categoryEmoji(picked.category)}</span>
                <span className="flex-1 text-sm font-medium truncate">{picked.display_name_fr}</span>
                <button
                  onClick={() => setPicked(null)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Changer
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Quantité</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    autoFocus
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Unité</span>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="space-y-1 text-sm block">
                <span className="font-medium">Date d&apos;expiration (optionnel)</span>
                <input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                />
              </label>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex gap-2 p-4 border-t">
          <button
            onClick={onClose}
            className="flex-1 h-9 rounded-md border text-sm hover:bg-accent"
          >
            Annuler
          </button>
          <button
            onClick={() => createMut.mutate()}
            disabled={!picked || !quantity || createMut.isPending}
            className="flex-1 h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ajouter"}
          </button>
        </div>
      </div>
    </div>
  );
}
