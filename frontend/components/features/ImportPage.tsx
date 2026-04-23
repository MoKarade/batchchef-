"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { importsApi, type ImportJob } from "@/lib/api";
import { useJobWebSocket, type JobProgress } from "@/lib/ws";
import { Upload, Play, Clock, CheckCircle2, XCircle, Loader2, Ban } from "lucide-react";

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{value.toLocaleString()} / {max.toLocaleString()} URLs</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300 rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function JobCard({ job }: { job: ImportJob }) {
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

  const current = progress?.current ?? job.progress_current;
  const total = progress?.total ?? job.progress_total;
  const status = progress?.status ?? job.status;
  const cancelRequested = job.cancel_requested || cancelMut.isPending;

  const icon =
    status === "completed" ? <CheckCircle2 className="h-4 w-4 text-green-500" /> :
    status === "failed" ? <XCircle className="h-4 w-4 text-destructive" /> :
    status === "cancelled" ? <Ban className="h-4 w-4 text-muted-foreground" /> :
    status === "running" ? <Loader2 className="h-4 w-4 text-primary animate-spin" /> :
    <Clock className="h-4 w-4 text-muted-foreground" />;

  return (
    <div className="rounded-xl border bg-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium text-sm">
            Import Marmiton #{job.id}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground capitalize">{status}</span>
          {isActive && (
            <button
              onClick={() => cancelMut.mutate()}
              disabled={cancelRequested}
              className="flex items-center gap-1 rounded-md border border-destructive/40 text-destructive px-2 h-7 text-xs hover:bg-destructive/10 disabled:opacity-50"
            >
              <Ban className="h-3 w-3" />
              {cancelRequested ? "Annulation…" : "Annuler"}
            </button>
          )}
        </div>
      </div>

      <ProgressBar value={current} max={total} />

      {(progress?.current_item ?? job.current_item) && (
        <p className="text-xs text-muted-foreground truncate">
          {progress?.current_item ?? job.current_item}
        </p>
      )}

      {progress?.eta_seconds ? (
        <p className="text-xs text-muted-foreground">
          ETA : ~{Math.round((progress.eta_seconds) / 60)} min restantes
        </p>
      ) : null}
    </div>
  );
}

export function ImportPage() {
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState<string>("");

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["import-jobs"],
    queryFn: () => importsApi.listJobs().then((r) => r.data),
    refetchInterval: 10_000,
  });

  const startMutation = useMutation({
    mutationFn: (l?: number) => importsApi.start(l),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["import-jobs"] }),
  });

  const handleStart = () => {
    const l = limit ? parseInt(limit) : undefined;
    startMutation.mutate(l);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="title-serif text-3xl font-bold">Import Marmiton</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Lance le scraping des 43 492 recettes depuis cleaned_recipes.txt
        </p>
      </div>

      {/* Start panel */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Upload className="h-5 w-5 text-primary" />
          <span className="font-semibold">Lancer un import</span>
        </div>

        <div className="flex gap-3 items-end">
          <div className="space-y-1 flex-1">
            <label className="text-xs font-medium text-muted-foreground">
              Limite (optionnel, laisser vide = tout)
            </label>
            <input
              type="number"
              placeholder="ex: 100"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            />
          </div>
          <button
            onClick={handleStart}
            disabled={startMutation.isPending}
            className="flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 h-9 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {startMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Démarrer
          </button>
        </div>

        {startMutation.isError && (
          <p className="text-sm text-destructive">
            Erreur: le worker Celery est-il démarré ? (Redis requis)
          </p>
        )}
      </div>

      {/* Jobs list */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Historique des imports
        </h2>
        {isLoading && <p className="text-sm text-muted-foreground">Chargement...</p>}
        {!isLoading && jobs.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucun import lancé.</p>
        )}
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
    </div>
  );
}
