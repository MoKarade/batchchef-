"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { ingredientsApi, type IngredientMaster } from "@/lib/api";

/**
 * Reusable typeahead chip picker over the canonical ingredient catalogue
 * (parent_id IS NULL). Used by both /recipes (filter by ingredient) and
 * /batch (restrict auto-suggestions by ingredient).
 */
export function IngredientChipPicker({
  label,
  tone,
  selected,
  onAdd,
  onRemove,
}: {
  label: string;
  tone: "include" | "exclude";
  selected: IngredientMaster[];
  onAdd: (ing: IngredientMaster) => void;
  onRemove: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const { data: suggestions = [] } = useQuery({
    queryKey: ["ingredient-suggest", query],
    queryFn: () =>
      ingredientsApi
        .list({
          search: query || undefined,
          parent_id: "null",
          limit: 8,
        })
        .then((r) => r.data),
    enabled: open && query.trim().length >= 1,
    staleTime: 30_000,
  });

  const toneCls =
    tone === "include"
      ? "bg-primary/15 text-primary border-primary/30 hover:bg-primary/25"
      : "bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/25";

  const selectedIds = new Set(selected.map((s) => s.id));
  const filtered = suggestions.filter((s) => !selectedIds.has(s.id));

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mr-1">
          {label}
        </span>
        {selected.map((ing) => (
          <span
            key={ing.id}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${toneCls}`}
          >
            {ing.display_name_fr}
            <button
              onClick={() => onRemove(ing.id)}
              aria-label="Retirer"
              className="ml-0.5 h-4 w-4 rounded-full hover:bg-background/30 inline-flex items-center justify-center"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <div className="relative inline-block">
          <input
            placeholder="+ ajouter"
            value={query}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 w-28 rounded-full border border-dashed border-input bg-background px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {open && filtered.length > 0 && (
            <div className="absolute z-20 left-0 top-9 w-56 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-lg">
              {filtered.map((ing) => (
                <button
                  key={ing.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onAdd(ing);
                    setQuery("");
                    setOpen(false);
                  }}
                  className="w-full text-left text-xs px-3 py-1.5 hover:bg-accent transition-colors block"
                >
                  <span className="font-medium">{ing.display_name_fr}</span>
                  <span className="text-muted-foreground ml-1 font-mono text-[10px]">
                    ({ing.canonical_name})
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
