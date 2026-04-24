"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { batchesApi, type ShoppingItem } from "@/lib/api";
import { formatPrice } from "@/lib/utils";
import { ArrowLeft, ShoppingCart, Loader2, Package, Check, Trash2, Boxes, ExternalLink, Store as StoreIcon, Zap, NotebookPen } from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ShoppingExportButton } from "./ShoppingExportPanel";
import { useConfirm } from "@/components/shared/ConfirmDialog";
import { authApi } from "@/lib/api";

/**
 * Build a store search URL for an item that has no direct product_url
 * mapped yet. Uses the store's name hint to pick the right site, falls
 * back to Maxi (primary store).
 */
function buildStoreSearchUrl(item: ShoppingItem): string {
  const name =
    item.ingredient?.display_name_fr ??
    item.ingredient?.canonical_name?.replace(/_/g, " ") ??
    "";
  const q = encodeURIComponent(name);
  const storeName = (item.store?.name ?? "").toLowerCase();
  if (storeName.includes("costco")) return `https://www.costco.ca/s?dept=All&keyword=${q}`;
  return `https://www.maxi.ca/fr/recherche?search-bar=${q}`;
}

function ShoppingRow({
  batchId,
  item,
  selected,
  onToggleSelect,
}: {
  batchId: number;
  item: ShoppingItem;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const qc = useQueryClient();

  const mutate = useMutation({
    mutationFn: async (purchased: boolean) => {
      if (purchased) await batchesApi.purchaseItem(batchId, item.id);
      else await batchesApi.unpurchaseItem(batchId, item.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batch", batchId] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
    },
  });

  const name = item.ingredient?.display_name_fr ?? `Ingrédient #${item.ingredient_master_id}`;
  const packagesLabel = item.format_qty
    ? `${item.packages_to_buy} × ${item.format_qty}${item.format_unit ?? ""}`
    : `${item.packages_to_buy} ${item.unit}`;
  // Surplus (leftover pack volume going to inventory). Computed only when
  // the package unit matches the need unit — otherwise we'd subtract
  // "2 × 1 kg" from "500 g" and get nonsense. When units differ, the
  // backend already stores everything in compatible bases but the
  // format_unit can still be kg while quantity_needed is in g, so
  // normalize here: if format_unit is kg/L and need is g/ml, scale.
  const surplus = (() => {
    if (!item.format_qty || !item.packages_to_buy) return 0;
    const fu = (item.format_unit ?? "").toLowerCase();
    const nu = (item.unit ?? "").toLowerCase();
    // Scale factor to convert format_qty into the "unit" base
    let scale = 1;
    if (fu === nu) scale = 1;
    else if (fu === "kg" && nu === "g") scale = 1000;
    else if (fu === "g" && nu === "kg") scale = 0.001;
    else if (fu === "l" && nu === "ml") scale = 1000;
    else if (fu === "ml" && nu === "l") scale = 0.001;
    else if (fu === "cl" && nu === "ml") scale = 10;
    else if (fu === "ml" && nu === "cl") scale = 0.1;
    else return 0; // incompatible — skip the display
    return item.packages_to_buy * item.format_qty * scale - item.quantity_needed;
  })();

  return (
    <li className={`flex items-center gap-3 rounded-lg border p-3 ${item.is_purchased ? "bg-green-50 border-green-200" : "bg-card"}`}>
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        disabled={item.is_purchased}
        className="shrink-0 h-4 w-4"
        aria-label={`Sélectionner ${name}`}
      />
      <button
        onClick={() => mutate.mutate(!item.is_purchased)}
        disabled={mutate.isPending}
        className={`shrink-0 h-6 w-6 rounded-md border flex items-center justify-center transition-colors ${
          item.is_purchased ? "bg-green-600 border-green-600 text-white" : "bg-background hover:border-primary"
        }`}
        aria-label={item.is_purchased ? "Marquer comme non acheté" : "Marquer comme acheté"}
      >
        {mutate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
         item.is_purchased ? <Check className="h-3.5 w-3.5" /> : null}
      </button>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${item.is_purchased ? "line-through text-muted-foreground" : ""}`}>
          {name}
        </p>
        <p className="text-xs text-muted-foreground">
          Besoin : {item.quantity_needed.toLocaleString()} {item.unit}
          {item.from_inventory_qty > 0 && (
            <span className="text-green-600"> — {item.from_inventory_qty} déjà en stock</span>
          )}
        </p>
      </div>

      <div className="text-right shrink-0">
        <p className="text-sm font-semibold">{packagesLabel}</p>
        {item.store && (
          <p className="text-xs text-muted-foreground">{item.store.name}</p>
        )}
        {item.estimated_cost != null && (
          <p className="text-xs text-muted-foreground">{formatPrice(item.estimated_cost)}</p>
        )}
        {/* Direct product link if we have one, otherwise fallback to a
            pre-filled Maxi/Costco search so the user can ALWAYS jump to
            the store for this ingredient (user report: "je vois pas le
            lien" — it was conditional on product_url being mapped). */}
        {item.product_url ? (
          <a
            href={item.product_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5 font-semibold"
          >
            Voir sur {item.store?.name ?? "Maxi"}{" "}
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        ) : (
          <a
            href={buildStoreSearchUrl(item)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-muted-foreground hover:text-primary hover:underline inline-flex items-center gap-0.5"
          >
            Chercher sur Maxi <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
        {surplus > 0 && item.format_unit && (
          <p className="text-[11px] text-blue-600 flex items-center gap-1 justify-end mt-0.5">
            <Package className="h-3 w-3" /> +{surplus.toLocaleString()}{item.format_unit} au stock
          </p>
        )}
      </div>
    </li>
  );
}

export function ShoppingListPage({ batchId }: { batchId: number }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [storeFilter, setStoreFilter] = useState<string>("all");

  const { data: batch, isLoading } = useQuery({
    queryKey: ["batch", batchId],
    queryFn: () => batchesApi.get(batchId).then((r) => r.data),
  });

  // Filtered by store (for the chips at the top). Grouping still runs
  // on the filtered subset so each section header makes sense.
  const filteredItems = useMemo(() => {
    if (!batch) return [];
    if (storeFilter === "all") return batch.shopping_items;
    return batch.shopping_items.filter((i) => {
      const n = i.store?.name?.toLowerCase() ?? "";
      return n.includes(storeFilter.toLowerCase());
    });
  }, [batch, storeFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, ShoppingItem[]>();
    for (const it of filteredItems) {
      const key = it.store?.name ?? "Autre";
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    return map;
  }, [filteredItems]);

  // All stores present in the full batch (for filter chips — never changes
  // based on current filter)
  const storesPresent = useMemo(() => {
    if (!batch) return [];
    const counts: Record<string, number> = {};
    for (const it of batch.shopping_items) {
      const name = it.store?.name?.toLowerCase() ?? "autre";
      counts[name] = (counts[name] ?? 0) + 1;
    }
    return Object.entries(counts)
      .filter(([n]) => n !== "autre")
      .sort((a, b) => b[1] - a[1]);
  }, [batch]);

  const purchasable = useMemo(
    () => (batch?.shopping_items ?? []).filter((i) => !i.is_purchased),
    [batch],
  );

  const totalPurchased = batch?.shopping_items.filter((i) => i.is_purchased).length ?? 0;
  const total = batch?.shopping_items.length ?? 0;

  const bulkMut = useMutation({
    mutationFn: () => batchesApi.bulkPurchase(batchId, Array.from(selectedIds)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batch", batchId] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      setSelectedIds(new Set());
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => batchesApi.delete(batchId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batches"] });
      router.push("/batches");
    },
  });

  const toggle = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(purchasable.map((i) => i.id)));
  };
  const clearSelection = () => setSelectedIds(new Set());

  if (isLoading) {
    return <div className="max-w-2xl space-y-3">{Array.from({length: 4}).map((_,i) => <div key={i} className="h-14 rounded-lg border animate-pulse" />)}</div>;
  }
  if (!batch) {
    return <p className="text-sm text-muted-foreground">Batch introuvable.</p>;
  }

  return (
    <div className="space-y-5 max-w-2xl pb-24">
      <div>
        <Link href="/batches" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Retour
        </Link>
        <div className="flex items-start justify-between gap-3 mt-2">
          <div>
            <h1 className="title-serif text-3xl font-bold flex items-center gap-2">
              <ShoppingCart className="h-6 w-6 text-primary" />
              {batch.name ?? `Batch #${batch.id}`}
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {totalPurchased}/{total} achetés
              {batch.total_estimated_cost != null && ` — Total estimé : ${formatPrice(batch.total_estimated_cost)}`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <MaxiCartButton batchId={batch.id} />
            <GoogleTasksButton batchId={batch.id} />
            <ShoppingExportButton
              items={filteredItems}
              batchName={batch.name ?? `Batch #${batch.id}`}
            />
            <button
              onClick={async () => {
                if (
                  await confirm({
                    title: "Supprimer ce batch ?",
                    message:
                      "La liste de courses et toutes ses données seront perdues.",
                    destructive: true,
                    confirmLabel: "Supprimer",
                  })
                ) {
                  deleteMut.mutate();
                }
              }}
              disabled={deleteMut.isPending}
              className="text-xs px-3 h-9 rounded-full border border-destructive/30 text-destructive hover:bg-destructive/10 inline-flex items-center gap-1 shrink-0"
            >
              {deleteMut.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              Supprimer
            </button>
          </div>
        </div>
      </div>

      {/* ── Store filter pills ───────────────────────────────────── */}
      {storesPresent.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mr-1 flex items-center gap-1">
            <StoreIcon className="h-3 w-3" />
            Magasin
          </span>
          <button
            onClick={() => setStoreFilter("all")}
            className={`h-8 rounded-full px-3 text-xs font-semibold transition ${
              storeFilter === "all"
                ? "bg-primary text-primary-foreground shadow"
                : "bg-card border hover:bg-accent"
            }`}
          >
            Tous · {batch.shopping_items.length}
          </button>
          {storesPresent.map(([name, count]) => {
            const label = name.charAt(0).toUpperCase() + name.slice(1);
            const active = storeFilter === name;
            const specialCls =
              active && name === "maxi"
                ? "bg-[#e40046] text-white shadow"
                : active && name === "costco"
                ? "bg-[#004c91] text-white shadow"
                : active
                ? "bg-primary text-primary-foreground shadow"
                : "bg-card border hover:bg-accent";
            return (
              <button
                key={name}
                onClick={() => setStoreFilter(name)}
                className={`h-8 rounded-full px-3 text-xs font-semibold transition ${specialCls}`}
              >
                {label} · {count}
              </button>
            );
          })}
        </div>
      )}

      {purchasable.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground border-y py-2">
          <button onClick={selectAll} className="hover:text-foreground">
            Sélectionner tous les non-achetés ({purchasable.length})
          </button>
          {selectedIds.size > 0 && (
            <button onClick={clearSelection} className="hover:text-foreground">
              Tout désélectionner
            </button>
          )}
        </div>
      )}

      {total === 0 && <p className="text-sm text-muted-foreground">Aucun article à acheter — tout est en stock.</p>}

      {Array.from(grouped.entries()).map(([storeName, items]) => (
        <section key={storeName} className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{storeName}</h2>
          <ul className="space-y-2">
            {items.map((it) => (
              <ShoppingRow
                key={it.id}
                batchId={batch.id}
                item={it}
                selected={selectedIds.has(it.id)}
                onToggleSelect={() => toggle(it.id)}
              />
            ))}
          </ul>
        </section>
      ))}

      <p className="text-xs text-muted-foreground italic">
        Cocher un article le marque comme acheté, déduit la quantité utilisée de l&apos;inventaire
        et ajoute le surplus (ex : 4,5 kg restants sur un sac de 5 kg) au stock.
      </p>

      {dialog}

      {selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-xl w-[calc(100%-2rem)]">
          <div className="rounded-xl border bg-background shadow-lg p-3 flex items-center gap-3">
            <span className="text-sm font-medium flex-1">
              {selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}
            </span>
            <button
              onClick={clearSelection}
              className="text-xs px-3 h-9 rounded-md border hover:bg-accent"
            >
              Annuler
            </button>
            <button
              onClick={() => bulkMut.mutate()}
              disabled={bulkMut.isPending}
              className="text-xs px-3 h-9 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1 disabled:opacity-50"
            >
              {bulkMut.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Boxes className="h-3 w-3" />
              )}
              Ajouter à l&apos;inventaire
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Button that triggers the Playwright-driven Maxi cart filler.
 * Disabled (with tooltip) if the user hasn't saved Maxi creds yet.
 */
function MaxiCartButton({ batchId }: { batchId: number }) {
  const { data: creds } = useQuery({
    queryKey: ["maxi-creds"],
    queryFn: () => authApi.getMaxiCreds().then((r) => r.data),
    staleTime: 60_000,
  });

  const fillMut = useMutation({
    mutationFn: () => batchesApi.fillMaxiCart(batchId),
    onSuccess: ({ data }) => {
      toast.success(
        `Panier en cours de remplissage — job #${data.job_id}. Chromium s'ouvre sur ton bureau.`,
        { duration: 6000 },
      );
    },
    onError: (err) => {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Impossible de lancer le remplissage";
      toast.error(msg);
    },
  });

  const hasCreds = creds?.has_creds ?? false;

  if (!hasCreds) {
    return (
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 h-9 rounded-full border border-dashed border-primary/50 text-primary px-4 text-xs font-semibold hover:bg-primary/5"
        title="Enregistre d'abord tes creds Maxi dans /settings"
      >
        <Zap className="h-3.5 w-3.5" />
        Activer panier Maxi
      </Link>
    );
  }

  return (
    <button
      onClick={() => fillMut.mutate()}
      disabled={fillMut.isPending}
      className="inline-flex items-center gap-1.5 h-9 rounded-full bg-[#e40046] text-white px-4 text-xs font-semibold shadow hover:shadow-md disabled:opacity-60 transition"
      title="Lance un Chromium qui se connecte à Maxi et remplit ton panier"
    >
      {fillMut.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Zap className="h-3.5 w-3.5" />
      )}
      Remplir panier Maxi
    </button>
  );
}

/**
 * Exporter-toward-Google-Tasks button. Synchronous — no Celery — since
 * the Tasks API is fast (few hundred ms even for 30 items). Falls back to
 * "Connect" if the user hasn't OAuthed yet, same pattern as MaxiCartButton.
 */
function GoogleTasksButton({ batchId }: { batchId: number }) {
  const { data: gs } = useQuery({
    queryKey: ["google-status"],
    queryFn: () => authApi.getGoogleStatus().then((r) => r.data),
    staleTime: 60_000,
  });

  const exportMut = useMutation({
    mutationFn: () => batchesApi.exportToGoogleTasks(batchId),
    onSuccess: ({ data }) => {
      toast.success(
        `${data.tasks_created}/${data.total_items} exportés vers "${data.title}" (${data.google_email})`,
        { duration: 6000 },
      );
    },
    onError: (err) => {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Export Google Tasks impossible";
      toast.error(msg);
    },
  });

  const connected = gs?.connected ?? false;

  if (!connected) {
    return (
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 h-9 rounded-full border border-dashed border-[#4285F4]/50 text-[#4285F4] px-4 text-xs font-semibold hover:bg-[#4285F4]/5"
        title="Connecte ton compte Google dans /settings"
      >
        <NotebookPen className="h-3.5 w-3.5" />
        Activer Google Tasks
      </Link>
    );
  }

  return (
    <button
      onClick={() => exportMut.mutate()}
      disabled={exportMut.isPending}
      className="inline-flex items-center gap-1.5 h-9 rounded-full bg-[#4285F4] text-white px-4 text-xs font-semibold shadow hover:shadow-md disabled:opacity-60 transition"
      title="Crée une liste Google Tasks avec toutes les courses"
    >
      {exportMut.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <NotebookPen className="h-3.5 w-3.5" />
      )}
      Google Tasks
    </button>
  );
}
