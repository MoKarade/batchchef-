"use client";

import { useCallback, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  storesApi,
  ingredientsApi,
  importsApi,
  recipesApi,
  type ImportJob,
} from "@/lib/api";
import { useJobWebSocket, type JobProgress } from "@/lib/ws";
import {
  Play,
  Loader2,
  CheckCircle2,
  RefreshCw,
  Store as StoreIcon,
  Sparkles,
  X,
  ChevronDown,
  ChevronRight,
  Wrench,
  ShoppingCart,
} from "lucide-react";
import { type PriceCoverageOut } from "@/lib/api";

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{value.toLocaleString()} / {max.toLocaleString()}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function PriceCoveragePanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["price-coverage"],
    queryFn: () => ingredientsApi.priceCoverage().then((r) => r.data),
  });
  const retryMut = useMutation({
    mutationFn: () => ingredientsApi.retryMissingPrices(),
    onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ["price-coverage"] }), 2000),
  });

  const coverage = data as PriceCoverageOut | undefined;

  return (
    <div className="space-y-3">
      <h3 className="font-semibold flex items-center gap-2 text-sm">
        <ShoppingCart className="h-4 w-4" /> Couverture prix Maxi
      </h3>
      {isLoading && <p className="text-xs text-muted-foreground">Chargement…</p>}
      {coverage && (
        <>
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{coverage.priced} / {coverage.total} ingrédients avec prix</span>
              <span className="font-semibold">{coverage.coverage_pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${coverage.coverage_pct}%` }}
              />
            </div>
          </div>
          {Object.entries(coverage.by_store).length > 0 && (
            <div className="flex gap-4 text-xs text-muted-foreground">
              {Object.entries(coverage.by_store).map(([store, count]) => (
                <span key={store} className="capitalize">{store}: {count}</span>
              ))}
            </div>
          )}
          {coverage.unpriced.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-destructive">
                {coverage.unpriced.length} sans prix
              </p>
              <ul className="max-h-40 overflow-y-auto text-xs text-muted-foreground space-y-0.5 rounded-md border bg-muted/30 p-2">
                {coverage.unpriced.map((ing) => (
                  <li key={ing.id} className="flex justify-between">
                    <span>{ing.display_name_fr}</span>
                    <span className="text-muted-foreground/60">{ing.attempts} essai{ing.attempts !== 1 ? "s" : ""}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => retryMut.mutate()}
                disabled={retryMut.isPending}
                className="text-xs h-7 px-3 rounded-md border hover:bg-accent disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {retryMut.isPending ? (
                  <><Loader2 className="h-3 w-3 animate-spin" /> En cours…</>
                ) : (
                  <><RefreshCw className="h-3 w-3" /> Relancer les manquants</>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}


function PriceMappingJobCard({ job }: { job: ImportJob }) {
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const active = job.status === "running" || job.status === "queued";

  useJobWebSocket(active ? job.id : null, useCallback((d) => setProgress(d), []));

  const current = progress?.current ?? job.progress_current;
  const total = progress?.total ?? job.progress_total;
  const status = progress?.status ?? job.status;
  const canCancel = status === "running" || status === "queued";

  const handleCancel = async () => {
    if (!confirm("Annuler ce job ? Le worker Celery sera interrompu.")) return;
    setCancelling(true);
    try {
      await importsApi.cancel(job.id);
    } catch (e) {
      console.error(e);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium truncate">{labelForJobType(job.job_type)} #{job.id}</span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground capitalize">{status}</span>
          {canCancel && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 h-6 text-[11px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
              title="Annuler le job"
            >
              {cancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
              Annuler
            </button>
          )}
        </div>
      </div>
      <ProgressBar value={current} max={total} />
      {progress?.current_item && (
        <p className="text-xs text-muted-foreground truncate">{progress.current_item}</p>
      )}
    </div>
  );
}

function labelForJobType(t: string): string {
  if (t === "price_mapping") return "Mapping des prix Maxi";
  if (t === "marmiton_bulk") return "Import Marmiton";
  return t;
}

function PriceMappingPanel() {
  const qc = useQueryClient();
  const { data: ingredients = [] } = useQuery({
    queryKey: ["ingredients-stats"],
    queryFn: () => ingredientsApi.list({ limit: 500 }).then((r) => r.data),
    refetchInterval: 15_000,
  });

  const pending = ingredients.filter((i) => i.price_mapping_status !== "mapped").length;
  const mapped = ingredients.length - pending;

  const startMap = useMutation({
    mutationFn: () => storesApi.mapPrices(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ingredients-stats"] }),
  });

  const [jobs, setJobs] = useState<ImportJob[]>([]);

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <StoreIcon className="h-5 w-5 text-primary" />
        <span className="font-semibold">Prix des ingrédients</span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Mappés</p>
          <p className="text-xl font-bold">{mapped}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">À mapper</p>
          <p className="text-xl font-bold">{pending}</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={async () => {
            const r = await startMap.mutateAsync();
            setJobs((prev) => [r.data, ...prev]);
          }}
          disabled={startMap.isPending}
          className="flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 h-9 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {startMap.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Mapper tous les prix (Maxi)
        </button>
      </div>

      {jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((j) => (
            <PriceMappingJobCard key={j.id} job={j} />
          ))}
        </div>
      )}

      {startMap.isError && (
        <p className="text-sm text-destructive">
          Erreur : le worker Celery est-il démarré ? (Redis requis)
        </p>
      )}
    </div>
  );
}

function ClassifyPanel() {
  const [jobId, setJobId] = useState<number | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);

  useJobWebSocket(jobId, (p) => {
    setProgress(p);
    if (p.status === "completed" || p.status === "failed" || p.status === "cancelled") {
      setJobId(null);
    }
  });

  const classify = useMutation({
    mutationFn: () => recipesApi.classifyPending(),
    onSuccess: (res) => { setJobId(res.data.id); setProgress(null); },
  });

  const running = !!jobId || classify.isPending;
  const done = progress?.status === "completed";

  return (
    <div className="rounded-xl border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">Classification IA des recettes</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Calcule le <strong>health score</strong>, meal_type, tags et régimes pour toutes les recettes
        non encore classifiées (statut « scraped »).
      </p>

      {progress && jobId && (
        <ProgressBar value={progress.current ?? 0} max={progress.total ?? 0} />
      )}
      {done && (
        <p className="text-sm text-green-600 flex items-center gap-1">
          <CheckCircle2 className="h-4 w-4" /> Classification terminée ({progress?.current} recettes)
        </p>
      )}

      <button
        onClick={() => classify.mutate()}
        disabled={running}
        className="flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {running ? `Classification… ${progress ? `${progress.current}/${progress.total}` : ""}` : "Classifier les recettes (health score)"}
      </button>
    </div>
  );
}

export function SettingsPage() {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="title-serif text-3xl font-bold">Paramètres</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Variables d&apos;environnement et outils manuels (les imports cascadent automatiquement).
        </p>
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-3">
        <h2 className="font-semibold">Variables d&apos;environnement</h2>
        <p className="text-sm text-muted-foreground">
          Modifiez <code className="bg-muted px-1 rounded text-xs">backend/.env</code> pour
          configurer la clé Gemini, le Maxi local, la concurrence Playwright, etc.
        </p>
        <ul className="text-sm space-y-1 text-muted-foreground list-disc list-inside">
          <li><code className="text-xs bg-muted px-1 rounded">GEMINI_API_KEY</code> — Clé Google AI Studio</li>
          <li><code className="text-xs bg-muted px-1 rounded">MAXI_STORE_ID</code> — ID de votre Maxi local (défaut 8676)</li>
          <li><code className="text-xs bg-muted px-1 rounded">SCRAPE_CONCURRENCY</code> — Pages Playwright parallèles</li>
        </ul>
      </div>

      <div className="rounded-xl border bg-card">
        <button
          onClick={() => setAdvancedOpen((v) => !v)}
          className="w-full flex items-center gap-2 p-5 text-left hover:bg-accent/30"
        >
          {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Wrench className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold">Outils avancés</span>
          <span className="text-xs text-muted-foreground ml-auto">
            (déclenchés automatiquement après chaque import)
          </span>
        </button>
        {advancedOpen && (
          <div className="p-5 pt-0 space-y-6">
            <p className="text-xs text-muted-foreground italic">
              Ces actions sont normalement déclenchées automatiquement lors d&apos;un import Marmiton.
              Utilise-les seulement pour forcer un remap après une édition manuelle d&apos;ingrédient.
            </p>
            <PriceCoveragePanel />
            <hr className="border-muted" />
            <PriceMappingPanel />
            <ClassifyPanel />
          </div>
        )}
      </div>
    </div>
  );
}
