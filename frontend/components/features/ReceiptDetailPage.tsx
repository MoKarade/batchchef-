"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { receiptsApi, ingredientsApi, type ReceiptItem, type IngredientMaster } from "@/lib/api";
import { formatPrice } from "@/lib/utils";
import { ArrowLeft, CheckCircle2, Loader2, Plus, Trash2, X, Receipt as ReceiptIcon } from "lucide-react";
import Link from "next/link";

function IngredientAutocomplete({
  value,
  onChange,
  rawName,
}: {
  value: number | null | undefined;
  onChange: (id: number | null, name: string) => void;
  rawName?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const { data: selected } = useQuery({
    queryKey: ["ingredient-resolved", value],
    queryFn: async () => {
      if (!value) return null;
      const r = await ingredientsApi.list({ limit: 500 });
      return r.data.find((i) => i.id === value) ?? null;
    },
    enabled: !!value,
  });

  const { data: matches = [] } = useQuery({
    queryKey: ["ingredient-search", query],
    queryFn: () => ingredientsApi.list({ search: query || undefined, limit: 10 }).then((r) => r.data),
    enabled: open,
  });

  const label = selected?.display_name_fr ?? (rawName ? `? ${rawName}` : "Non mappé");

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`h-8 px-2 rounded-md border text-xs text-left w-full truncate ${
          selected ? "bg-background" : "bg-amber-50 border-amber-300"
        }`}
      >
        {label}
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-64 rounded-md border bg-popover shadow-lg p-2 space-y-1">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher..."
            className="h-8 w-full rounded-md border bg-background px-2 text-xs"
          />
          <div className="max-h-60 overflow-auto">
            {value && (
              <button
                onClick={() => { onChange(null, ""); setOpen(false); }}
                className="w-full text-left text-xs px-2 py-1 rounded hover:bg-accent text-muted-foreground flex items-center gap-1"
              >
                <X className="h-3 w-3" /> Désassigner
              </button>
            )}
            {matches.map((ing: IngredientMaster) => (
              <button
                key={ing.id}
                onClick={() => { onChange(ing.id, ing.display_name_fr); setOpen(false); setQuery(""); }}
                className="w-full text-left text-xs px-2 py-1 rounded hover:bg-accent"
              >
                {ing.display_name_fr}
                {ing.category && <span className="text-muted-foreground"> — {ing.category}</span>}
              </button>
            ))}
            {matches.length === 0 && query && (
              <p className="text-xs text-muted-foreground px-2 py-1">Aucun résultat.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ItemRow({
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
  const [raw, setRaw] = useState(item.raw_name ?? "");
  const [qty, setQty] = useState(item.quantity?.toString() ?? "");
  const [unit, setUnit] = useState(item.unit ?? "");
  const [price, setPrice] = useState(item.total_price?.toString() ?? "");
  const [ingId, setIngId] = useState<number | null>(item.ingredient_master_id ?? null);

  const update = useMutation({
    mutationFn: (data: Record<string, string | number | null | undefined>) =>
      receiptsApi.updateItem(scanId, item.id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["receipt", scanId] }),
  });
  const remove = useMutation({
    mutationFn: () => receiptsApi.deleteItem(scanId, item.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["receipt", scanId] }),
  });

  const commitField = (field: keyof ReceiptItem, raw: string, numeric: boolean) => {
    const v = numeric ? (raw ? parseFloat(raw) : null) : (raw || null);
    if (v === (item[field] ?? null)) return;
    update.mutate({ [field]: v });
  };

  return (
    <tr className={`border-t ${checked ? "bg-green-50" : ""}`}>
      <td className="py-2 pr-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(item.id, e.target.checked)}
          className="h-4 w-4"
        />
      </td>
      <td className="py-2 pr-2">
        <input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={() => commitField("raw_name", raw, false)}
          placeholder="Nom brut"
          className="h-8 w-32 rounded-md border bg-background px-2 text-xs"
        />
      </td>
      <td className="py-2 pr-2 min-w-[180px]">
        <IngredientAutocomplete
          value={ingId}
          rawName={item.raw_name ?? undefined}
          onChange={(id) => {
            setIngId(id);
            update.mutate({ ingredient_master_id: id });
          }}
        />
      </td>
      <td className="py-2 pr-2">
        <input
          type="number"
          step="0.01"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onBlur={() => commitField("quantity", qty, true)}
          className="h-8 w-20 rounded-md border bg-background px-2 text-xs"
        />
      </td>
      <td className="py-2 pr-2">
        <select
          value={unit}
          onChange={(e) => { setUnit(e.target.value); update.mutate({ unit: e.target.value || null }); }}
          className="h-8 rounded-md border bg-background px-2 text-xs"
        >
          <option value="">—</option>
          <option value="kg">kg</option>
          <option value="g">g</option>
          <option value="l">l</option>
          <option value="ml">ml</option>
          <option value="unite">unité</option>
        </select>
      </td>
      <td className="py-2 pr-2">
        <input
          type="number"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onBlur={() => commitField("total_price", price, true)}
          placeholder="0.00"
          className="h-8 w-20 rounded-md border bg-background px-2 text-xs"
        />
      </td>
      <td className="py-2 text-right">
        <button
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
          className="h-7 w-7 rounded-md border hover:bg-destructive/10 text-destructive inline-flex items-center justify-center"
          aria-label="Supprimer"
        >
          {remove.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        </button>
      </td>
    </tr>
  );
}

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
    mutationFn: () => receiptsApi.addItem(scanId, { raw_name: "", quantity: 1, unit: "unite" }),
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
      if (c) next.add(id); else next.delete(id);
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

  if (isLoading) return <div className="max-w-4xl h-64 rounded-xl border animate-pulse" />;
  if (!scan) return <p className="text-sm text-muted-foreground">Ticket introuvable.</p>;

  const processing = scan.status === "pending" || scan.status === "processing";
  const ready = scan.items.filter((i) => i.ingredient_master_id).length;

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <Link href="/receipts" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Retour
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="title-serif text-3xl font-bold flex items-center gap-2">
              <ReceiptIcon className="h-6 w-6 text-primary" />
              Ticket #{scan.id}
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Status : <span className="font-medium">{scan.status}</span>
              {scan.total_amount != null && ` — Total ${formatPrice(scan.total_amount)}`}
              {scan.items.length > 0 && ` — ${ready}/${scan.items.length} mappés`}
            </p>
          </div>
          <button
            onClick={() => confirm.mutate()}
            disabled={confirm.isPending || selected.size === 0 || processing}
            className="flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 h-9 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {confirm.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Confirmer ({selected.size}) et injecter
          </button>
        </div>
      </div>

      {scan.error_message && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {scan.error_message}
        </div>
      )}

      <div className="grid md:grid-cols-[320px_1fr] gap-5">
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Image</p>
          {imgUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgUrl}
              alt={`Ticket ${scan.id}`}
              className="w-full rounded-lg border bg-muted object-contain max-h-[600px]"
            />
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Lignes détectées</p>
            <button
              onClick={() => addItem.mutate()}
              disabled={addItem.isPending}
              className="flex items-center gap-1 text-xs px-2 h-7 rounded-md border hover:bg-accent"
            >
              {addItem.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Ajouter ligne
            </button>
          </div>

          {processing && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyse Gemini Vision en cours...
            </div>
          )}

          <div className="overflow-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr className="text-left">
                  <th className="py-2 px-2 w-8"></th>
                  <th className="py-2 px-2">OCR</th>
                  <th className="py-2 px-2">Ingrédient</th>
                  <th className="py-2 px-2">Qté</th>
                  <th className="py-2 px-2">Unité</th>
                  <th className="py-2 px-2">Prix $</th>
                  <th className="py-2 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {scan.items.map((it) => (
                  <ItemRow
                    key={it.id}
                    scanId={scan.id}
                    item={it}
                    checked={selected.has(it.id)}
                    onToggle={toggle}
                  />
                ))}
                {scan.items.length === 0 && !processing && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-muted-foreground">
                      Aucune ligne détectée. Ajoutez-en manuellement.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground italic">
            Cochez les lignes correctes puis cliquez « Confirmer » — elles seront ajoutées à
            l&apos;inventaire avec un mouvement de type <code className="text-[11px] bg-muted px-1 rounded">receipt_scan</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
