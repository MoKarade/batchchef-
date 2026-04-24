"use client";

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { importsApi, type ImportJob } from "@/lib/api";
import { useJobWebSocket, type JobProgress } from "@/lib/ws";
import {
  Upload,
  Play,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Ban,
  ChevronDown,
  ChevronUp,
  BookOpen,
  CircleDollarSign,
  Sparkles,
  Activity,
  TrendingUp,
  AlertTriangle,
  Zap,
  RotateCcw,
  Filter,
  Link as LinkIcon,
  Receipt as ReceiptIcon,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

/**
 * /imports — rich job tracking dashboard.
 *
 * Sections:
 *   1. KPI ribbon: active / today / success rate
 *   2. Active jobs (running / queued) — live WS progress
 *   3. Start-new-import panel
 *   4. Filterable history (by type, by status)
 *   5. Per-job expandable details: error breakdown, ETA, speed
 *
 * Supports every ``job_type`` currently emitted by the backend:
 *   marmiton_bulk, marmiton_continuous, price_mapping,
 *   classify_recipes, receipt_ocr, zombie_cleanup
 */

// ── Job type metadata ────────────────────────────────────────────────────────
const JOB_META: Record<
  string,
  {
    label: string;
    emoji: string;
    icon: typeof BookOpen;
    tint: string;
    iconTint: string;
    unit: string;
  }
> = {
  marmiton_bulk: {
    label: "Import Marmiton",
    emoji: "📖",
    icon: BookOpen,
    tint: "from-amber-500/10 to-amber-500/5 border-amber-500/30",
    iconTint: "text-amber-600 bg-amber-500/15",
    unit: "URLs",
  },
  marmiton_continuous: {
    label: "Import continu",
    emoji: "🔄",
    icon: RotateCcw,
    tint: "from-amber-500/10 to-amber-500/5 border-amber-500/30",
    iconTint: "text-amber-600 bg-amber-500/15",
    unit: "URLs",
  },
  price_mapping: {
    label: "Price Mapping",
    emoji: "💰",
    icon: CircleDollarSign,
    tint: "from-emerald-500/10 to-emerald-500/5 border-emerald-500/30",
    iconTint: "text-emerald-600 bg-emerald-500/15",
    unit: "ingrédients",
  },
  classify_recipes: {
    label: "Classification IA",
    emoji: "✨",
    icon: Sparkles,
    tint: "from-violet-500/10 to-violet-500/5 border-violet-500/30",
    iconTint: "text-violet-600 bg-violet-500/15",
    unit: "recettes",
  },
  receipt_ocr: {
    label: "OCR reçu",
    emoji: "🧾",
    icon: ReceiptIcon,
    tint: "from-sky-500/10 to-sky-500/5 border-sky-500/30",
    iconTint: "text-sky-600 bg-sky-500/15",
    unit: "items",
  },
  zombie_cleanup: {
    label: "Nettoyage zombies",
    emoji: "🧹",
    icon: Activity,
    tint: "from-slate-500/10 to-slate-500/5 border-slate-500/30",
    iconTint: "text-slate-600 bg-slate-500/15",
    unit: "jobs",
  },
};

function metaFor(type: string) {
  return (
    JOB_META[type] ?? {
      label: type,
      emoji: "⚙️",
      icon: Activity,
      tint: "from-slate-500/10 to-slate-500/5 border-slate-500/30",
      iconTint: "text-slate-600 bg-slate-500/15",
      unit: "items",
    }
  );
}

// ── Status helpers ───────────────────────────────────────────────────────────
const STATUS_META: Record<
  string,
  { label: string; cls: string; icon: typeof CheckCircle2 }
> = {
  running: { label: "En cours", cls: "bg-blue-100 text-blue-800 border-blue-200", icon: Loader2 },
  queued: { label: "En attente", cls: "bg-gray-100 text-gray-800 border-gray-200", icon: Clock },
  completed: { label: "Terminé", cls: "bg-green-100 text-green-800 border-green-200", icon: CheckCircle2 },
  failed: { label: "Échoué", cls: "bg-red-100 text-red-800 border-red-200", icon: XCircle },
  cancelled: { label: "Annulé", cls: "bg-amber-100 text-amber-800 border-amber-200", icon: Ban },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_META[status] ?? STATUS_META.queued;
  const Icon = s.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${s.cls}`}
    >
      <Icon className={`h-3 w-3 ${status === "running" ? "animate-spin" : ""}`} />
      {s.label}
    </span>
  );
}

// ── Error log parsing ────────────────────────────────────────────────────────
type ErrorBreakdown = {
  total: number;
  skip: number;
  quarantine: number;
  other: number;
  samples: string[];
};

function parseErrors(errorLog: string | null | undefined): ErrorBreakdown | null {
  if (!errorLog) return null;
  try {
    const errs: string[] = JSON.parse(errorLog);
    if (!Array.isArray(errs)) return null;
    return {
      total: errs.length,
      skip: errs.filter((e) => String(e).includes("SKIP")).length,
      quarantine: errs.filter((e) => String(e).includes("QUARANTINE")).length,
      other: errs.filter(
        (e) => !String(e).includes("SKIP") && !String(e).includes("QUARANTINE"),
      ).length,
      samples: errs.slice(-5),
    };
  } catch {
    return { total: 1, skip: 0, quarantine: 0, other: 1, samples: [errorLog] };
  }
}

// ── Main Page ────────────────────────────────────────────────────────────────
export function ImportTrackingPage() {
  const qc = useQueryClient();
  const [limitStr, setLimitStr] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["import-jobs"],
    queryFn: () => importsApi.listJobs().then((r) => r.data),
    refetchInterval: 5_000,
  });

  const startMut = useMutation({
    mutationFn: (l?: number) => importsApi.start(l),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["import-jobs"] }),
  });

  // ── Derived metrics ───────────────────────────────────────────────────────
  const { activeJobs, historyJobs, kpis } = useMemo(() => {
    const active = jobs.filter((j) => j.status === "running" || j.status === "queued");
    const history = jobs.filter((j) => !["running", "queued"].includes(j.status));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayJobs = jobs.filter(
      (j) => new Date(j.created_at).getTime() >= today.getTime(),
    );
    const finishedToday = todayJobs.filter((j) =>
      ["completed", "failed", "cancelled"].includes(j.status),
    );
    const successRate =
      finishedToday.length > 0
        ? Math.round(
            (finishedToday.filter((j) => j.status === "completed").length /
              finishedToday.length) *
              100,
          )
        : null;

    return {
      activeJobs: active,
      historyJobs: history,
      kpis: {
        active: active.length,
        today: todayJobs.length,
        successRate,
      },
    };
  }, [jobs]);

  // Filter history jobs by user-selected filters
  const filteredHistory = useMemo(() => {
    return historyJobs.filter((j) => {
      if (typeFilter !== "all" && j.job_type !== typeFilter) return false;
      if (statusFilter !== "all" && j.status !== statusFilter) return false;
      return true;
    });
  }, [historyJobs, typeFilter, statusFilter]);

  const knownTypes = useMemo(
    () => Array.from(new Set(jobs.map((j) => j.job_type))).sort(),
    [jobs],
  );

  return (
    <div className="space-y-6">
      {/* ── Header ───────────────────────────────────────────────── */}
      <header>
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold flex items-center gap-1.5">
          <Activity className="h-3 w-3" />
          Suivi d&apos;imports & jobs
        </p>
        <h1 className="title-serif text-3xl sm:text-4xl font-bold leading-tight mt-1">
          Tableau de bord des tâches
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tous les jobs de scraping, mapping prix, classification IA et OCR —
          en temps réel.
        </p>
      </header>

      {/* ── KPI ribbon ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          label="Jobs actifs"
          value={kpis.active}
          sub="en cours ou queued"
          icon={Zap}
          tint="text-primary bg-primary/10"
          pulse={kpis.active > 0}
        />
        <KpiCard
          label="Aujourd'hui"
          value={kpis.today}
          sub="jobs créés"
          icon={Clock}
          tint="text-secondary bg-secondary/10"
        />
        <KpiCard
          label="Taux de succès"
          value={kpis.successRate != null ? `${kpis.successRate}%` : "—"}
          sub="des jobs terminés aujourd'hui"
          icon={TrendingUp}
          tint={
            kpis.successRate == null
              ? "text-muted-foreground bg-muted"
              : kpis.successRate >= 80
              ? "text-green-600 bg-green-500/10"
              : kpis.successRate >= 50
              ? "text-amber-600 bg-amber-500/10"
              : "text-destructive bg-destructive/10"
          }
        />
      </div>

      {/* ── Active jobs ──────────────────────────────────────────── */}
      {activeJobs.length > 0 && (
        <section>
          <h2 className="title-serif text-xl font-bold mb-3 flex items-center gap-2">
            <Loader2 className="h-4 w-4 text-primary animate-spin" />
            Jobs actifs
            <span className="text-xs font-normal text-muted-foreground">
              ({activeJobs.length})
            </span>
          </h2>
          <div className="space-y-3">
            {activeJobs.map((j) => (
              <JobRow key={j.id} job={j} defaultOpen />
            ))}
          </div>
        </section>
      )}

      {/* ── Quick start panel ────────────────────────────────────── */}
      <section>
        <div className="rounded-2xl border bg-card p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Upload className="h-4 w-4" />
            </div>
            <div>
              <h3 className="title-serif font-bold">Lancer un import Marmiton</h3>
              <p className="text-[11px] text-muted-foreground">
                Scraping depuis <code className="text-[10px]">cleaned_recipes.txt</code>{" "}
                (43 492 URLs disponibles)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-end">
            <div className="space-y-1 flex-1 min-w-[140px]">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Limite
              </label>
              <input
                type="number"
                placeholder="vide = tout"
                value={limitStr}
                onChange={(e) => setLimitStr(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <button
              onClick={() =>
                startMut.mutate(limitStr ? parseInt(limitStr) : undefined)
              }
              disabled={startMut.isPending}
              className="h-9 rounded-lg bg-primary text-primary-foreground px-4 text-xs font-semibold shadow hover:shadow-md inline-flex items-center gap-1.5 disabled:opacity-50 transition"
            >
              {startMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Démarrer
            </button>
          </div>

          {startMut.isError && (
            <p className="mt-2 text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Erreur — vérifie que Celery + Redis tournent.
            </p>
          )}
        </div>
      </section>

      {/* ── History ──────────────────────────────────────────────── */}
      <section>
        <div className="flex items-end justify-between mb-3 flex-wrap gap-2">
          <h2 className="title-serif text-xl font-bold">Historique</h2>

          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-8 rounded-md border bg-background text-xs px-2"
            >
              <option value="all">Tous types</option>
              {knownTypes.map((t) => (
                <option key={t} value={t}>
                  {metaFor(t).emoji} {metaFor(t).label}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 rounded-md border bg-background text-xs px-2"
            >
              <option value="all">Tous statuts</option>
              <option value="completed">Terminé</option>
              <option value="failed">Échoué</option>
              <option value="cancelled">Annulé</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card/50 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Aucun job dans l&apos;historique avec ces filtres.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredHistory.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tint,
  pulse = false,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: typeof Zap;
  tint: string;
  pulse?: boolean;
}) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </span>
        <div
          className={`h-7 w-7 rounded-lg flex items-center justify-center ${tint} ${
            pulse ? "animate-pulse" : ""
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <p className="title-serif text-3xl font-bold leading-none">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}

// ── JobRow — expandable ──────────────────────────────────────────────────────
function JobRow({ job, defaultOpen = false }: { job: ImportJob; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const qc = useQueryClient();

  const isActive = job.status === "running" || job.status === "queued";

  useJobWebSocket(
    isActive ? job.id : null,
    useCallback((data) => setProgress(data), []),
  );

  const cancelMut = useMutation({
    mutationFn: () => importsApi.cancel(job.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["import-jobs"] }),
  });

  const meta = metaFor(job.job_type);
  const Icon = meta.icon;
  const current = progress?.current ?? job.progress_current;
  const total = progress?.total ?? job.progress_total;
  const status = progress?.status ?? job.status;
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const errors = parseErrors(job.error_log);

  // Duration + speed
  const startedAt = job.started_at ? new Date(job.started_at) : null;
  const finishedAt = job.finished_at ? new Date(job.finished_at) : null;
  const endAt = finishedAt ?? (isActive ? new Date() : null);
  const durationSec =
    startedAt && endAt ? (endAt.getTime() - startedAt.getTime()) / 1000 : 0;
  const speedPerMin =
    durationSec > 0 ? Math.round((current / durationSec) * 60) : 0;
  const etaSec =
    isActive && speedPerMin > 0 && total > current
      ? ((total - current) / speedPerMin) * 60
      : null;

  const cancelRequested = job.cancel_requested || cancelMut.isPending;

  return (
    <div
      className={`rounded-xl border bg-gradient-to-br ${meta.tint} transition-shadow ${
        open ? "shadow-md" : "hover:shadow-sm"
      }`}
    >
      {/* Collapsed row */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full p-3 sm:p-4 text-left flex items-center gap-3"
      >
        <div
          className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${meta.iconTint}`}
        >
          <Icon
            className={`h-4 w-4 ${status === "running" ? "animate-pulse" : ""}`}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">
              {meta.label} <span className="text-muted-foreground">#{job.id}</span>
            </span>
            <StatusBadge status={status} />
            {errors && errors.total > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700">
                <AlertTriangle className="h-2.5 w-2.5" />
                {errors.total} erreurs
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground flex-wrap">
            <span>
              {current.toLocaleString("fr-CA")} /{" "}
              {total.toLocaleString("fr-CA")} {meta.unit}
            </span>
            <span>•</span>
            <span className="font-semibold">{pct}%</span>
            {startedAt && (
              <>
                <span>•</span>
                <span>
                  {isActive
                    ? `démarré ${formatDistanceToNow(startedAt, {
                        addSuffix: true,
                        locale: fr,
                      })}`
                    : `il y a ${formatDistanceToNow(startedAt, { locale: fr })}`}
                </span>
              </>
            )}
          </div>

          {/* Inline progress bar */}
          {total > 0 && (
            <div className="mt-2 h-1.5 rounded-full bg-background/60 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  status === "failed"
                    ? "bg-destructive"
                    : status === "cancelled"
                    ? "bg-amber-500"
                    : status === "completed"
                    ? "bg-green-500"
                    : "bg-primary"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>

        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="px-3 sm:px-4 pb-4 space-y-3 border-t border-border/40 pt-3">
          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MiniStat
              label="Démarré"
              value={
                startedAt
                  ? format(startedAt, "dd/MM HH:mm", { locale: fr })
                  : "—"
              }
            />
            <MiniStat
              label="Durée"
              value={
                durationSec > 0 ? formatDuration(durationSec) : "—"
              }
            />
            <MiniStat
              label="Vitesse"
              value={speedPerMin > 0 ? `${speedPerMin}/min` : "—"}
            />
            <MiniStat
              label="ETA"
              value={etaSec ? formatDuration(etaSec) : "—"}
            />
          </div>

          {/* Current item */}
          {(progress?.current_item ?? job.current_item) && (
            <div className="rounded-lg bg-background/60 border px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5 flex items-center gap-1">
                <LinkIcon className="h-2.5 w-2.5" />
                Item actuel
              </p>
              <p className="text-xs truncate">
                {progress?.current_item ?? job.current_item}
              </p>
            </div>
          )}

          {/* Error breakdown */}
          {errors && errors.total > 0 && (
            <div className="rounded-lg bg-background/60 border px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 flex items-center gap-1">
                <AlertTriangle className="h-2.5 w-2.5 text-amber-600" />
                Erreurs : {errors.total}
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                {errors.skip > 0 && (
                  <span className="inline-flex items-center gap-1 rounded bg-amber-100 text-amber-800 px-2 py-0.5 font-semibold">
                    SKIP: {errors.skip}
                  </span>
                )}
                {errors.quarantine > 0 && (
                  <span className="inline-flex items-center gap-1 rounded bg-orange-100 text-orange-800 px-2 py-0.5 font-semibold">
                    QUARANTINE: {errors.quarantine}
                  </span>
                )}
                {errors.other > 0 && (
                  <span className="inline-flex items-center gap-1 rounded bg-red-100 text-red-800 px-2 py-0.5 font-semibold">
                    Autres: {errors.other}
                  </span>
                )}
              </div>
              {errors.samples.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
                    Voir les 5 dernières erreurs
                  </summary>
                  <ul className="mt-1.5 space-y-0.5">
                    {errors.samples.map((e, i) => (
                      <li
                        key={i}
                        className="text-[10px] font-mono text-muted-foreground truncate"
                        title={e}
                      >
                        {e}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {/* Metadata */}
          {job.celery_task_id && (
            <p className="text-[10px] text-muted-foreground font-mono">
              task: {job.celery_task_id}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {isActive && (
              <button
                onClick={() => cancelMut.mutate()}
                disabled={cancelRequested}
                className="inline-flex items-center gap-1 rounded-lg border border-destructive/40 text-destructive px-3 h-8 text-xs font-semibold hover:bg-destructive/10 disabled:opacity-50 transition"
              >
                <Ban className="h-3 w-3" />
                {cancelRequested ? "Annulation..." : "Annuler"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background/60 border px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </p>
      <p className="text-sm font-semibold mt-0.5">{value}</p>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m ? `${h}h${m}` : `${h}h`;
}
