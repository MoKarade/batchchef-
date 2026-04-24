"use client";

import { useState, useMemo } from "react";
import type { ShoppingItem } from "@/lib/api";
import {
  Download,
  Copy,
  ExternalLink,
  X,
  ShoppingCart,
  ClipboardList,
  Check,
  FileDown,
  Store as StoreIcon,
} from "lucide-react";
import toast from "react-hot-toast";

/**
 * Shopping list export — pick a store, get a product-link list or CSV.
 *
 * Why per-store: Maxi and Costco don't share a cart, so once you pick a
 * store you want to focus only on its items. Mixed lists (some from Maxi,
 * some from Costco) cause confusion when you're actually in a store aisle.
 *
 * The "Ouvrir sur Maxi" / "Ouvrir sur Costco" button opens every product
 * URL of that store in a new tab. Browsers may prompt for popup permission
 * the first time — the user authorises it once per origin.
 *
 * CSV export format (tab-separated, excel-friendly):
 *   ingredient<TAB>quantity<TAB>unit<TAB>packages<TAB>cost<TAB>store<TAB>url
 */

// ── Store meta ───────────────────────────────────────────────────────────────
const STORE_META: Record<
  string,
  { label: string; color: string; homepage: string }
> = {
  maxi: {
    label: "Maxi",
    color: "bg-[#e40046] text-white",
    homepage: "https://www.maxi.ca",
  },
  costco: {
    label: "Costco",
    color: "bg-[#004c91] text-white",
    homepage: "https://www.costco.ca",
  },
};

function storeSlug(name?: string | null): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes("maxi")) return "maxi";
  if (n.includes("costco")) return "costco";
  return null;
}

// ── Exported helpers ─────────────────────────────────────────────────────────
export function ShoppingExportButton({
  items,
  batchName,
}: {
  items: ShoppingItem[];
  batchName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-9 rounded-full bg-secondary text-secondary-foreground px-4 text-xs font-semibold shadow hover:shadow-md transition"
      >
        <Download className="h-3.5 w-3.5" />
        Exporter
      </button>
      {open && (
        <ExportModal
          items={items}
          batchName={batchName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────
function ExportModal({
  items,
  batchName,
  onClose,
}: {
  items: ShoppingItem[];
  batchName: string;
  onClose: () => void;
}) {
  // All stores present in the list
  const available = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) {
      const slug = storeSlug(it.store?.name);
      if (slug) s.add(slug);
    }
    return Array.from(s);
  }, [items]);

  const [pickedStore, setPickedStore] = useState<string | "all">(
    available[0] ?? "all",
  );

  const filtered = useMemo(() => {
    if (pickedStore === "all") return items;
    return items.filter((it) => storeSlug(it.store?.name) === pickedStore);
  }, [items, pickedStore]);

  // Sub-split: which items have a direct URL vs. none
  const withUrl = filtered.filter((i) => i.product_url);
  const withoutUrl = filtered.filter((i) => !i.product_url);

  const totalCost = filtered.reduce((s, i) => s + (i.estimated_cost ?? 0), 0);

  // ── Actions ────────────────────────────────────────────────────────────
  const openAllTabs = () => {
    const urls = withUrl.map((i) => i.product_url!).filter(Boolean);
    if (urls.length === 0) {
      toast.error("Aucun lien produit dans cette liste");
      return;
    }
    if (urls.length > 12) {
      const ok = confirm(
        `Ouvrir ${urls.length} onglets ? Ton navigateur peut bloquer les pop-ups.`,
      );
      if (!ok) return;
    }
    let blocked = 0;
    for (const url of urls) {
      const w = window.open(url, "_blank");
      if (!w) blocked++;
    }
    if (blocked > 0) {
      toast.error(
        `${blocked} onglets bloqués — autorise les pop-ups pour ce site.`,
      );
    } else {
      toast.success(`${urls.length} onglets ouverts`);
    }
  };

  const buildPlainText = () => {
    const header = `Liste de courses — ${batchName}`;
    const lines = filtered.map((it) => {
      const name = it.ingredient?.display_name_fr ?? `#${it.ingredient_master_id}`;
      const qty = it.format_qty
        ? `${it.packages_to_buy}× ${it.format_qty}${it.format_unit ?? ""}`
        : `${it.packages_to_buy} ${it.unit}`;
      const store = it.store?.name ? ` [${it.store.name}]` : "";
      return `- ${name}  —  ${qty}${store}`;
    });
    const footer = totalCost > 0 ? `\nTotal estimé : ${totalCost.toFixed(2)} $` : "";
    return `${header}\n${"=".repeat(header.length)}\n\n${lines.join("\n")}${footer}`;
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(buildPlainText());
      toast.success("Liste copiée");
    } catch {
      toast.error("Copie impossible — autorise l'accès au presse-papier");
    }
  };

  const downloadCsv = () => {
    // TSV (tab-separated) — opens cleanly in Excel/Sheets on both locales
    const header = [
      "Ingrédient", "Quantité", "Unité", "Paquets",
      "Format", "Coût estimé", "Magasin", "URL",
    ].join("\t");
    const rows = filtered.map((it) => [
      it.ingredient?.display_name_fr ?? `#${it.ingredient_master_id}`,
      it.quantity_needed,
      it.unit,
      it.packages_to_buy,
      it.format_qty ? `${it.format_qty}${it.format_unit ?? ""}` : "",
      it.estimated_cost?.toFixed(2) ?? "",
      it.store?.name ?? "",
      it.product_url ?? "",
    ].map((v) => String(v ?? "").replace(/\t/g, " ")).join("\t"));
    const blob = new Blob([header + "\n" + rows.join("\n")], {
      type: "text/tab-separated-values;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = batchName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "batch";
    a.download = `courses-${safeName}-${pickedStore}.tsv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Fichier téléchargé");
  };

  const openStorePickup = () => {
    const meta = STORE_META[pickedStore as string];
    if (!meta) return;
    // Maxi/Costco both have a pickup/delivery page — we just land on the
    // homepage, the store's own UX takes over.
    window.open(meta.homepage, "_blank");
  };

  const storeMeta = pickedStore !== "all" ? STORE_META[pickedStore] : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-2xl bg-background rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="p-5 border-b flex items-start justify-between gap-3 shrink-0">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold flex items-center gap-1.5">
              <ClipboardList className="h-3 w-3" />
              Exporter la liste
            </p>
            <h3 className="title-serif text-xl font-bold mt-0.5">
              {batchName}
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {filtered.length} articles · {totalCost.toFixed(2)} $
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg border hover:bg-accent flex items-center justify-center shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Store picker */}
          <section>
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
              Pour quel magasin ?
            </h4>
            <div className="flex flex-wrap gap-2">
              <PickerPill
                active={pickedStore === "all"}
                onClick={() => setPickedStore("all")}
                label={`Tous · ${items.length}`}
              />
              {available.map((s) => {
                const m = STORE_META[s];
                const count = items.filter((i) => storeSlug(i.store?.name) === s).length;
                return (
                  <PickerPill
                    key={s}
                    active={pickedStore === s}
                    onClick={() => setPickedStore(s)}
                    label={`${m?.label ?? s} · ${count}`}
                    tint={m?.color}
                  />
                );
              })}
            </div>
          </section>

          {/* Primary actions */}
          <section>
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
              Commander en ligne
            </h4>
            <div className="grid gap-2 sm:grid-cols-2">
              <ActionCard
                onClick={openAllTabs}
                icon={<ExternalLink className="h-4 w-4" />}
                label="Ouvrir tous les produits"
                sub={`${withUrl.length} pages produit en onglets`}
                disabled={withUrl.length === 0}
                primary
              />
              <ActionCard
                onClick={openStorePickup}
                icon={<ShoppingCart className="h-4 w-4" />}
                label={
                  storeMeta
                    ? `Aller sur ${storeMeta.label}`
                    : "Choisir un magasin"
                }
                sub={
                  storeMeta
                    ? "Pour cueillette ou livraison"
                    : "Pour commander / pickup"
                }
                disabled={!storeMeta}
              />
            </div>
            {withoutUrl.length > 0 && (
              <p className="text-[11px] text-muted-foreground mt-2 flex items-start gap-1">
                <StoreIcon className="h-3 w-3 mt-0.5 shrink-0" />
                <span>
                  {withoutUrl.length} article(s) sans lien produit direct — à
                  chercher manuellement sur le site du magasin.
                </span>
              </p>
            )}
          </section>

          {/* Secondary actions */}
          <section>
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
              Autres formats
            </h4>
            <div className="grid gap-2 sm:grid-cols-2">
              <ActionCard
                onClick={copyText}
                icon={<Copy className="h-4 w-4" />}
                label="Copier la liste (texte)"
                sub="Pour SMS / mail / note"
              />
              <ActionCard
                onClick={downloadCsv}
                icon={<FileDown className="h-4 w-4" />}
                label="Télécharger CSV / Excel"
                sub="Tableur compatible"
              />
            </div>
          </section>

          {/* Preview */}
          <section>
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
              Aperçu
            </h4>
            <pre className="text-[11px] bg-muted/40 border rounded-lg p-3 max-h-56 overflow-auto whitespace-pre-wrap break-words">
              {buildPlainText()}
            </pre>
          </section>
        </div>

        <footer className="p-3 border-t bg-muted/20 shrink-0">
          <p className="text-[10px] text-muted-foreground text-center">
            Astuce : laisse le navigateur autoriser les pop-ups pour ouvrir
            tous les produits d&apos;un coup.
          </p>
        </footer>
      </div>
    </div>
  );
}

function PickerPill({
  active,
  onClick,
  label,
  tint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tint?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-9 rounded-full px-4 text-xs font-semibold transition ${
        active
          ? tint ?? "bg-primary text-primary-foreground shadow"
          : "bg-card border hover:bg-accent"
      }`}
    >
      {label}
      {active && <Check className="inline h-3 w-3 ml-1.5" />}
    </button>
  );
}

function ActionCard({
  onClick,
  icon,
  label,
  sub,
  disabled,
  primary,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sub: string;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-left rounded-xl p-3 transition ${
        disabled
          ? "bg-muted/30 border border-transparent opacity-50 cursor-not-allowed"
          : primary
          ? "bg-primary text-primary-foreground shadow hover:shadow-md"
          : "bg-card border hover:shadow-sm hover:border-primary/40"
      }`}
    >
      <div className="flex items-start gap-2">
        <div
          className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
            primary
              ? "bg-primary-foreground/20"
              : "bg-primary/10 text-primary"
          }`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-sm">{label}</p>
          <p
            className={`text-[11px] mt-0.5 ${
              primary ? "text-primary-foreground/80" : "text-muted-foreground"
            }`}
          >
            {sub}
          </p>
        </div>
      </div>
    </button>
  );
}
