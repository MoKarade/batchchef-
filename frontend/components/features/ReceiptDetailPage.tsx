"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  receiptsApi,
  ingredientsApi,
  type ReceiptItem,
  type ReceiptSuggestion,
  type IngredientMaster,
} from "@/lib/api";
import { formatPrice } from "@/lib/utils";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Plus,
  Trash2,
  Wand2,
  AlertTriangle,
  ChevronDown,
  Check,
  X,
  Receipt,
} from "lucide-react";
import Link from "next/link";

/**
 * Phase 4.2 — redesigned receipt detail page.
 *
 * Key changes vs. the old table UI:
 *   - Cards per line (not a dense table)
 *   - Smart auto-match: backend /suggest matches OCR raw_name to canonical
 *     parents via signature + token overlap. High-confidence hits show an
 *     inline "Accepter" button.
 *   - Price variance: when an ingredient is mapped and we know the Maxi
 *     price, we compare the ticket unit price and badge green / amber / red.
 *   - Image + content split on desktop, stacked on mobile.
 *   - Toute la carte est la hitbox pour le checkbox.
 */

// ─── Variance helpers ────────────────────────────────────────────────────────

type VariantState = "ok" | "warn" | "high" | "unknown";

function computeVariance(
  ticketTotal: number | null | undefined,
  ticketQty: number | null | undefined,
  ticketUnit: string | null | undefined,
  ingredient: IngredientMaster | null | undefined,
): { state: VariantState; deltaPct?: number; maxiShown?: string } {
  if (!ingredient) return { state: "unknown" };
  const maxiPrice = ingredient.computed_unit_price ?? null;
  const maxiLabel = ingredient.computed_unit_label ?? null;
  if (maxiPrice == null || maxiLabel == null) return { state: "unknown" };
  if (!ticketTotal || !ticketQty || ticketQty <= 0) return { state: "unknown" };

  // Only compare if units are compatible (naive: same unit string)
  const unitMatch =
    (ticketUnit ?? "").toLowerCase() === (maxiLabel ?? "").toLowerCase() ||
    (ticketUnit === "unite" && maxiLabel === "un") ||
    (ticketUnit === "un" && maxiLabel === "unite");
  if (!unitMatch) return { state: "unknown" };

  const ticketUnitPrice = ticketTotal / ticketQty;
  const delta = ((ticketUnitPrice - maxiPrice) / maxiPrice) * 100;
  const shownMaxi = `${formatPrice(maxiPrice)}/${maxiLabel}`;

  if (delta > 15) return { state: "high", deltaPct: delta, maxiShown: shownMaxi };
  if (delta > 5) return { state: "warn", deltaPct: delta, maxiShown: shownMaxi };
  return { state: "ok", deltaPct: delta, maxiShown: shownMaxi };
}

function VarianceBadge({
  state,
  deltaPct,
  maxiShown,
}: {
  state: VariantState;
  deltaPct?: number;
  maxiShown?: string;
}) {
  if (state === "unknown") return null;
  const cls = {
    ok: "bg-green-100 text-green-800 border-green-200",
    warn: "bg-amber-100 text-amber-800 border-amber-200",
    high: "bg-red-100 text-red-800 border-red-200",
  }[state];
  const sign = (deltaPct ?? 0) > 0 ? "+" : "";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}
      title={`Maxi : ${maxiShown}`}
    >
      {state === "ok" ? <Check className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
      {sign}{deltaPct?.toFixed(0)}% vs Maxi
    </span>
  );
}

// ─── Ingredient picker (popover) ─────────────────────────────────────────────

function IngredientPopover({
  current,
  rawName,
  onChange,
  onClose,
}: {
  current: IngredientMaster | null;
  rawName: string;
  onChange: (ing: IngredientMaster | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const { data: matches = [] } = useQuery({
    queryKey: ["ingredient-search-receipt", query],
    queryFn: () =>
      ingredientsApi
        .list({ search: query || undefined, parent_id: "null", limit: 12 })
        .then((r) => r.data),
  });

  return (
    <div className="absolute z-30 right-0 top-10 w-72 rounded-lg border bg-popover shadow-xl p-2">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Chercher "${rawName.slice(0, 30)}"...`}
        className="h-8 w-full rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-primary"
      />
      <div className="max-h-64 overflow-auto mt-1">
        {current && (
          <button
            onClick={() => { onChange(null); onClose(); }}
            className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent text-muted-foreground flex items-center gap-1.5"
          >
            <X className="h-3 w-3" /> Désassigner
          </button>
        )}
        {matches.map((ing) => (
          <button
            key={ing.id}
            onClick={() => { onChange(ing); onClose(); }}
            className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent flex items-center justify-between gap-2"
          >
            <span className="truncate">{ing.display_name_fr}</span>
            {ing.computed_unit_price != null && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                {formatPrice(ing.computed_unit_price)}/{ing.computed_unit_label}
              </span>
            )}
          </button>
        ))}
        {matches.length === 0 && (
          <p className="text-xs text-muted-foreground px-2 py-2">Aucun résultat.</p>
        )}
      </div>
    </div>
  );
}

// ─── Row card ────────────────────────────────────────────────────────────────

function ItemCard({
  scanId,
  item,
  checked,
  onToggle,
}: {
  scanId: number;
  item: ReceiptItem;
  checked: boolean;
  onToggle: (id: number, checked: boolean) => void;
}) {
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [qty, setQty] = useState(item.quantity?.toString() ?? "");
  const [unit, setUnit] = useState(item.unit ?? "");
  const [price, setPrice] = useState(item.total_price?.toString() ?? "");

  // Resolved ingredient (full object, for computed_unit_price etc.)
  const { data: ingredient } = useQuery({
    queryKey: ["ingredient-resolved", item.ingredient_master_id],
    queryFn: async () => {
      if (!item.ingredient_master_id) return null;
      const r = await ingredientsApi.details(item.ingredient_master_id);
      return r.data as IngredientMaster;
    },
    enabled: !!item.ingredient_master_id,
    staleTime: 60_000,
  });

  // Auto-match suggestion (only when no ingredient yet)
  const { data: suggestions = [] } = useQuery({
    queryKey: ["receipt-suggest", item.raw_name],
    queryFn: () => receiptsApi.suggest(item.raw_name ?? "").then((r) => r.data),
    enabled: !!item.raw_name && !item.ingredient_master_id,
    staleTime: 5 * 60_000,
  });
  const topSuggestion: ReceiptSuggestion | undefined = suggestions[0];
  const autoAccept = topSuggestion && topSuggestion.confidence >= 0.9;

  const update = useMutation({
    mutationFn: (data: Record<string, string | number | null | undefined>) =>
      receiptsApi.updateItem(scanId, item.id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["receipt", scanId] }),
  });
  const remove = useMutation({
    mutationFn: () => receiptsApi.deleteItem(scanId, item.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["receipt", scanId] }),
  });

  const commitField = (
    field: "quantity" | "total_price" | "unit",
    value: string,
    numeric: boolean,
  ) => {
    const v = numeric ? (value ? parseFloat(value) : null) : (value || null);
    if (v === (item[field] ?? null)) return;
    update.mutate({ [field]: v });
  };

  const accept = (s: ReceiptSuggestion) => {
    update.mutate({ ingredient_master_id: s.ingredient_id });
    // auto-toggle the checkbox when accepting
    onToggle(item.id, true);
  };

  const variance = computeVariance(
    item.total_price,
    item.quantity,
    item.unit,
    ingredient ?? null,
  );

  const hasIngredient = !!item.ingredient_master_id;
  const borderCls = checked
    ? "border-primary ring-1 ring-primary/30 bg-primary/5"
    : hasIngredient
      ? "border-border bg-card hover:border-primary/40"
      : "border-amber-200 bg-amber-50/40";

  return (
    <div className={`relative rounded-xl border p-3 transition-colors ${borderCls}`}>
      <div className="flex items-start gap-3">
        {/* Checkbox — only enabled when an ingredient is set */}
        <button
          onClick={() => onToggle(item.id, !checked)}
          disabled={!hasIngredient}
          className={`shrink-0 h-5 w-5 rounded-md border mt-0.5 inline-flex items-center justify-center ${
            checked
              ? "bg-primary border-primary text-primary-foreground"
              : hasIngredient
                ? "bg-background hover:bg-accent"
                : "bg-muted text-muted-foreground cursor-not-allowed"
          }`}
          aria-label={checked ? "Décocher" : "Cocher"}
          title={hasIngredient ? undefined : "Mapper à un ingrédient d'abord"}
        >
          {checked && <Check className="h-3.5 w-3.5" />}
        </button>

        <div className="flex-1 min-w-0 space-y-2">
          {/* Line 1: raw name + delete */}
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-muted-foreground font-mono truncate">
              {item.raw_name || <span className="italic">(pas de texte OCR)</span>}
            </p>
            <button
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="shrink-0 h-6 w-6 rounded-md hover:bg-destructive/10 text-destructive/70 hover:text-destructive inline-flex items-center justify-center"
              aria-label="Supprimer"
            >
              {remove.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            </button>
          </div>

          {/* Line 2: ingredient + variance */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <button
                onClick={() => setPickerOpen((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-md border px-2.5 h-7 text-sm font-medium ${
                  hasIngredient
                    ? "bg-background border-border hover:bg-accent"
                    : "bg-amber-100 border-amber-300 text-amber-900 hover:bg-amber-200"
                }`}
              >
                {hasIngredient ? (ingredient?.display_name_fr ?? "…") : "Non mappé"}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
              {pickerOpen && (
                <IngredientPopover
                  current={ingredient ?? null}
                  rawName={item.raw_name ?? ""}
                  onChange={(ing) => {
                    update.mutate({ ingredient_master_id: ing ? ing.id : null });
                    if (ing) onToggle(item.id, true);
                  }}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </div>

            <VarianceBadge
              state={variance.state}
              deltaPct={variance.deltaPct}
              maxiShown={variance.maxiShown}
            />
          </div>

          {/* Line 3: suggestion prompt (only when unmapped) */}
          {!hasIngredient && topSuggestion && (
            <div className="flex items-center gap-2 rounded-md bg-amber-100/60 border border-amber-200 px-2 py-1.5">
              <Wand2 className="h-3 w-3 text-amber-700 shrink-0" />
              <p className="text-xs text-amber-900 flex-1 truncate">
                Suggestion&nbsp;:{" "}
                <span className="font-semibold">{topSuggestion.name}</span>
                {topSuggestion.confidence >= 0.9 && (
                  <span className="ml-1 text-[10px]">(auto)</span>
                )}
              </p>
              <button
                onClick={() => accept(topSuggestion)}
                className="shrink-0 h-6 px-2 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90"
              >
                Accepter
              </button>
            </div>
          )}

          {/* Line 4: qty · unit · price inputs */}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="number"
              step="0.01"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onBlur={() => commitField("quantity", qty, true)}
              placeholder="Qté"
              className="h-8 w-20 rounded-md border bg-background px-2 text-xs"
            />
            <select
              value={unit}
              onChange={(e) => {
                const v = e.target.value;
                setUnit(v);
                commitField("unit", v, false);
              }}
              className="h-8 rounded-md border bg-background px-2 text-xs"
            >
              <option value="">—</option>
              <option value="kg">kg</option>
              <option value="g">g</option>
              <option value="l">l</option>
              <option value="ml">ml</option>
              <option value="unite">unité</option>
            </select>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                onBlur={() => commitField("total_price", price, true)}
                placeholder="0.00"
                className="h-8 w-20 rounded-md border bg-background px-2 text-xs"
              />
              <span className="text-xs text-muted-foreground">$</span>
            </div>
            {item.total_price != null && item.quantity && item.quantity > 0 && (
              <span className="text-[10px] text-muted-foreground">
                ({formatPrice(item.total_price / item.quantity)} / {item.unit || "un"})
              </span>
            )}

            {autoAccept && !hasIngredient && (
              <button
                onClick={() => topSuggestion && accept(topSuggestion)}
                className="ml-auto inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <Wand2 className="h-3 w-3" /> auto
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function ReceiptDetailPage({ scanId }: { scanId: number }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: scan, isLoading } = useQuery({
    queryKey: ["receipt", scanId],
    queryFn: () => receiptsApi.get(scanId).then((r) => r.data),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "processing" || s === "pending" ? 3_000 : false;
    },
  });

  // Seed checked set once, from items that already have an ingredient
  useEffect(() => {
    if (scan) {
      setSelected((prev) => {
        if (prev.size > 0) return prev;
        const next = new Set<number>();
        for (const it of scan.items) {
          if (it.ingredient_master_id) next.add(it.id);
        }
        return next;
      });
    }
  }, [scan]);

  const addItem = useMutation({
    mutationFn: () =>
      receiptsApi.addItem(scanId, { raw_name: "", quantity: 1, unit: "unite" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["receipt", scanId] }),
  });

  const confirm = useMutation({
    mutationFn: () => receiptsApi.confirm(scanId, Array.from(selected)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["receipt", scanId] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["receipts"] });
    },
  });

  const toggle = (id: number, c: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (c) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const imgUrl = useMemo(() => {
    if (!scan) return null;
    const clean = scan.image_path.replace(/\\/g, "/");
    const idx = clean.indexOf("uploads/");
    const rel = idx >= 0 ? clean.slice(idx + "uploads/".length) : clean;
    return `/uploads/${rel}`;
  }, [scan]);

  if (isLoading) return <div className="max-w-5xl h-64 rounded-xl border animate-pulse" />;
  if (!scan) return <p className="text-sm text-muted-foreground">Ticket introuvable.</p>;

  const processing = scan.status === "pending" || scan.status === "processing";
  const ready = scan.items.filter((i) => i.ingredient_master_id).length;
  const unmapped = scan.items.length - ready;

  return (
    <div className="space-y-4 max-w-5xl pb-24 md:pb-0">
      {/* Top bar */}
      <Link
        href="/receipts"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Retour aux tickets
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="title-serif text-3xl font-bold flex items-center gap-2">
            <Receipt className="h-6 w-6 text-primary" />
            Ticket #{scan.id}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span>{scan.status}</span>
            {scan.total_amount != null && (
              <>
                <span>·</span>
                <span className="font-medium text-foreground">
                  Total {formatPrice(scan.total_amount)}
                </span>
              </>
            )}
            {scan.items.length > 0 && (
              <>
                <span>·</span>
                <span>
                  <span className="text-green-600 font-medium">{ready}</span> mappés
                  {unmapped > 0 && (
                    <>
                      {" "}· <span className="text-amber-600 font-medium">{unmapped}</span> restants
                    </>
                  )}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {scan.error_message && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {scan.error_message}
        </div>
      )}

      {/* Body */}
      <div className="grid md:grid-cols-[360px_1fr] gap-5">
        {/* Image */}
        <div className="space-y-2 md:sticky md:top-4 md:self-start">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
            Image
          </p>
          {imgUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgUrl}
              alt={`Ticket ${scan.id}`}
              className="w-full rounded-lg border bg-muted object-contain max-h-[70vh]"
            />
          )}
        </div>

        {/* Lines */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
              Lignes détectées
            </p>
            <button
              onClick={() => addItem.mutate()}
              disabled={addItem.isPending}
              className="flex items-center gap-1 text-xs px-2.5 h-7 rounded-md border hover:bg-accent"
            >
              {addItem.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Ajouter
            </button>
          </div>

          {processing && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground rounded-lg border border-dashed p-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyse Gemini Vision en cours...
            </div>
          )}

          <div className="space-y-2">
            {scan.items.map((it) => (
              <ItemCard
                key={it.id}
                scanId={scan.id}
                item={it}
                checked={selected.has(it.id)}
                onToggle={toggle}
              />
            ))}
            {scan.items.length === 0 && !processing && (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                <Receipt className="h-6 w-6 mx-auto mb-2 opacity-40" />
                Aucune ligne détectée. Ajoutez-en manuellement.
              </div>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground italic">
            Coche les lignes à injecter dans le frigo · les variances vs Maxi
            sont calculées à partir des prix scrapés.
          </p>
        </div>
      </div>

      {/* Sticky bottom CTA on mobile, inline on desktop */}
      <div className="fixed md:absolute inset-x-0 bottom-0 md:static z-30 md:z-0 md:mt-4 bg-background/95 md:bg-transparent backdrop-blur-sm md:backdrop-blur-none border-t md:border-t-0 px-4 py-3 md:px-0">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground hidden md:block">
            {selected.size} ligne{selected.size > 1 ? "s" : ""} sélectionnée{selected.size > 1 ? "s" : ""}
          </p>
          <button
            onClick={() => confirm.mutate()}
            disabled={confirm.isPending || selected.size === 0 || processing}
            className="flex-1 md:flex-initial flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 h-11 md:h-10 text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
          >
            {confirm.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Injecter {selected.size > 0 ? `${selected.size} ligne${selected.size > 1 ? "s" : ""}` : ""} au frigo
          </button>
        </div>
      </div>
    </div>
  );
}
