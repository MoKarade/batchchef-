"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { receiptsApi, type ReceiptStats } from "@/lib/api";
import {
  Receipt as ReceiptIcon,
  Upload,
  Loader2,
  CheckCircle2,
  XCircle,
  Camera,
  Image as ImageIcon,
  TrendingUp,
  AlertTriangle,
  ListOrdered,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { formatPrice } from "@/lib/utils";

type Tab = "scans" | "tendances";

/**
 * Phase 4.1 + 4.3 — receipts list with mobile-first capture + trends tab.
 *
 * Changes vs. old:
 *   - Big "📷 Prendre en photo" primary CTA on mobile (uses capture=environment)
 *   - Desktop keeps the drag-drop + file picker
 *   - After upload: auto-redirect to /receipts/{id} so user can validate right away
 *   - New "Tendances" tab showing stats/weekly/top ingredients/price alerts
 */

export function ReceiptsListPage() {
  const [tab, setTab] = useState<Tab>("scans");

  return (
    <div className="space-y-5 max-w-4xl">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="title-serif text-3xl font-bold">Tickets de caisse</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Scan → Gemini Vision OCR → validation → frigo mis à jour
          </p>
        </div>
      </header>

      <div className="flex items-center gap-1 border-b">
        <TabBtn active={tab === "scans"} onClick={() => setTab("scans")}>
          <ReceiptIcon className="h-3.5 w-3.5" /> Scans
        </TabBtn>
        <TabBtn active={tab === "tendances"} onClick={() => setTab("tendances")}>
          <TrendingUp className="h-3.5 w-3.5" /> Tendances
        </TabBtn>
      </div>

      {tab === "scans" ? <ScansTab /> : <TendancesTab />}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium transition-colors border-b-2 ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Scans tab ───────────────────────────────────────────────────────────────

function ScansTab() {
  const qc = useQueryClient();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: scans = [], isLoading } = useQuery({
    queryKey: ["receipts"],
    queryFn: () => receiptsApi.list().then((r) => r.data),
    refetchInterval: 5_000,
  });

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const res = await receiptsApi.upload(file);
      await qc.invalidateQueries({ queryKey: ["receipts"] });
      // Auto-redirect to the new scan so the user can validate immediately
      router.push(`/receipts/${res.data.id}`);
    } finally {
      setUploading(false);
    }
  };

  const statusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    if (status === "error") return <XCircle className="h-4 w-4 text-destructive" />;
    return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  };

  return (
    <div className="space-y-5">
      {/* Mobile: big camera CTA */}
      <div className="md:hidden space-y-2">
        <button
          onClick={() => cameraRef.current?.click()}
          disabled={uploading}
          className="w-full h-32 rounded-2xl bg-gradient-to-br from-primary to-secondary text-primary-foreground font-bold text-lg inline-flex flex-col items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition-transform disabled:opacity-60"
        >
          {uploading ? (
            <Loader2 className="h-8 w-8 animate-spin" />
          ) : (
            <>
              <Camera className="h-10 w-10" />
              <span>Prendre en photo</span>
            </>
          )}
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="w-full h-10 rounded-lg border bg-card text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <ImageIcon className="h-4 w-4" />
          Choisir depuis la galerie
        </button>
      </div>

      {/* Desktop: drag-drop */}
      <div
        className="hidden md:flex rounded-xl border-2 border-dashed bg-card p-8 text-center cursor-pointer hover:border-primary transition-colors flex-col items-center gap-3"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
      >
        {uploading ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Upload en cours...</p>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium text-sm">Glisser-déposer une photo de ticket</p>
            <p className="text-xs text-muted-foreground">
              ou clique pour parcourir · JPG, PNG
            </p>
          </>
        )}
      </div>

      {/* Hidden inputs */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />

      {/* List */}
      <div className="space-y-2">
        {isLoading && <div className="h-20 rounded-xl border animate-pulse" />}
        {!isLoading && scans.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Aucun ticket scanné pour l&apos;instant.
          </p>
        )}
        {scans.map((scan) => {
          const mapped = scan.items?.filter((i) => i.ingredient_master_id).length ?? 0;
          const total = scan.items?.length ?? 0;
          return (
            <Link
              key={scan.id}
              href={`/receipts/${scan.id}`}
              className="block rounded-xl border bg-card p-3 hover:border-primary/40 hover:bg-accent/30 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <ReceiptIcon className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">
                      Ticket #{scan.id}
                      {scan.total_amount != null && (
                        <span className="font-normal text-muted-foreground">
                          {" "}· {formatPrice(scan.total_amount)}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(scan.created_at), "d MMM yyyy · HH:mm", { locale: fr })}
                      {total > 0 && (
                        <span className="ml-2">
                          · {mapped}/{total} mappés
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {statusIcon(scan.status)}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tendances tab ───────────────────────────────────────────────────────────

function TendancesTab() {
  const [months, setMonths] = useState(6);
  const { data: stats, isLoading } = useQuery({
    queryKey: ["receipts-stats", months],
    queryFn: () => receiptsApi.stats(months).then((r) => r.data),
    staleTime: 60_000,
  });

  if (isLoading) {
    return <div className="h-64 rounded-xl border animate-pulse" />;
  }
  if (!stats) return null;

  return (
    <div className="space-y-5">
      {/* Period toggle */}
      <div className="flex items-center gap-1">
        {[3, 6, 12].map((m) => (
          <button
            key={m}
            onClick={() => setMonths(m)}
            className={`h-7 px-3 rounded-full text-xs font-medium transition-colors ${
              months === m
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent"
            }`}
          >
            {m} mois
          </button>
        ))}
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Tile label="Ce mois" value={formatPrice(stats.totals.this_month)} />
        <Tile label="Mois dernier" value={formatPrice(stats.totals.last_month)} />
        <Tile
          label="Moyenne / sem."
          value={formatPrice(stats.totals.avg_weekly)}
          span="col-span-2 md:col-span-1"
        />
      </div>

      {/* Weekly bar chart */}
      {stats.weekly.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
            Dépense hebdo
          </h2>
          <WeeklyBars data={stats.weekly} />
        </section>
      )}

      {/* Top ingredients */}
      {stats.top_ingredients.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1.5">
            <ListOrdered className="h-3.5 w-3.5" /> Top dépenses par ingrédient
          </h2>
          <div className="rounded-xl border bg-card divide-y">
            {stats.top_ingredients.map((t, i) => (
              <div key={t.ingredient_id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="w-5 text-xs text-muted-foreground font-mono">#{i + 1}</span>
                <span className="flex-1 text-sm truncate">{t.name}</span>
                <span className="text-xs text-muted-foreground">{t.qty_times}×</span>
                <span className="text-sm font-semibold">{formatPrice(t.total)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Price alerts */}
      {stats.price_alerts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Alertes prix
          </h2>
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 divide-y divide-amber-100">
            {stats.price_alerts.map((a) => (
              <div key={a.ingredient_id} className="px-3 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{a.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Ticket moyen {formatPrice(a.avg_ticket_unit_price)} · Maxi {formatPrice(a.maxi_unit_price)}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-800 border border-red-200 px-2 py-0.5 text-xs font-semibold">
                  +{a.delta_pct.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground italic">
            Ces ingrédients coûtent &gt;10% plus cher à l&apos;achat que sur maxi.ca — envisage
            de les commander en ligne.
          </p>
        </section>
      )}

      {stats.weekly.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Pas encore assez de tickets pour afficher des tendances.
          <br />
          Scanne quelques tickets de caisse pour voir les statistiques.
        </div>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  span,
}: {
  label: string;
  value: string;
  span?: string;
}) {
  return (
    <div className={`rounded-xl border bg-card p-3 ${span || ""}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </p>
      <p className="text-xl font-bold mt-1">{value}</p>
    </div>
  );
}

function WeeklyBars({ data }: { data: ReceiptStats["weekly"] }) {
  const max = Math.max(...data.map((w) => w.total), 1);
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-end gap-1 h-32">
        {data.map((w) => {
          const h = Math.round((w.total / max) * 100);
          return (
            <div
              key={w.week}
              className="flex-1 flex flex-col items-center gap-1 group cursor-default"
              title={`${w.week} · ${formatPrice(w.total)} (${w.count} ticket${w.count > 1 ? "s" : ""})`}
            >
              <div className="w-full flex-1 flex items-end">
                <div
                  className="w-full rounded-t bg-gradient-to-t from-primary to-primary/60 group-hover:from-primary/90 group-hover:to-primary/50 transition-colors"
                  style={{ height: `${Math.max(h, 2)}%` }}
                />
              </div>
              <span className="text-[9px] text-muted-foreground tabular-nums">
                {w.week.split("-W")[1]}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground text-center">
        {data.length} semaine{data.length > 1 ? "s" : ""} · max {formatPrice(max)}
      </p>
    </div>
  );
}
