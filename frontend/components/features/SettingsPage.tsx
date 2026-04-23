"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  storesApi,
  ingredientsApi,
  importsApi,
  recipesApi,
  type ImportJob,
  type IngredientMaster,
  type StoreProduct,
} from "@/lib/api";
import { useJobWebSocket, type JobProgress } from "@/lib/ws";
import {
  Play,
  Loader2,
  CheckCircle2,
  RefreshCw,
  Store as StoreIcon,
  Leaf,
  Save,
  Sparkles,
  ShieldCheck,
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
        <ShoppingCart className="h-4 w-4" /> Couverture prix Maxi/Costco
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
  if (t === "price_mapping") return "Mapping des prix Maxi + Costco";
  if (t === "price_validation") return "Validation périodique des prix";
  if (t === "marmiton_bulk") return "Import Marmiton";
  if (t === "fruiterie_estimate") return "Estimation IA — Fruiterie 440";
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
  const startValidate = useMutation({
    mutationFn: () => storesApi.validatePrices(),
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
          Mapper tous les prix (Maxi + Costco)
        </button>

        <button
          onClick={async () => {
            const r = await startValidate.mutateAsync();
            setJobs((prev) => [r.data, ...prev]);
          }}
          disabled={startValidate.isPending}
          className="flex items-center gap-2 rounded-md border px-4 h-9 text-sm hover:bg-accent disabled:opacity-50"
        >
          {startValidate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Valider les prix existants
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

function FruiteriePricingRow({
  ingredient,
  product,
  onSave,
}: {
  ingredient: IngredientMaster;
  product?: StoreProduct;
  onSave: (data: { ingredient_master_id: number; price: number; format_qty: number; format_unit: string }) => Promise<void>;
}) {
  const [price, setPrice] = useState<string>(product?.price?.toString() ?? "");
  const [qty, setQty] = useState<string>(product?.format_qty?.toString() ?? "1");
  const [unit, setUnit] = useState<string>(product?.format_unit ?? ingredient.default_unit ?? "kg");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const p = parseFloat(price);
    const q = parseFloat(qty);
    if (!p || !q) return;
    setSaving(true);
    try {
      await onSave({
        ingredient_master_id: ingredient.id,
        price: p,
        format_qty: q,
        format_unit: unit,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="border-t">
      <td className="py-2 pr-3 text-sm">{ingredient.display_name_fr}</td>
      <td className="py-2 pr-2">
        <input
          type="number"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="0.00"
          className="w-20 h-8 rounded-md border bg-background px-2 text-sm"
        />
      </td>
      <td className="py-2 pr-2">
        <input
          type="number"
          step="0.1"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="w-20 h-8 rounded-md border bg-background px-2 text-sm"
        />
      </td>
      <td className="py-2 pr-2">
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          <option value="kg">kg</option>
          <option value="g">g</option>
          <option value="l">l</option>
          <option value="ml">ml</option>
          <option value="unite">unité</option>
        </select>
      </td>
      <td className="py-2 pr-2">
        {product == null || product.price == null ? (
          <span className="text-[10px] text-muted-foreground">—</span>
        ) : product.is_validated ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px]">
            <ShieldCheck className="h-3 w-3" /> Validé
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px]">
            <Sparkles className="h-3 w-3" /> IA {product.confidence_score != null ? `(${product.confidence_score.toFixed(1)})` : ""}
          </span>
        )}
      </td>
      <td className="py-2 text-right">
        <button
          onClick={handleSave}
          disabled={saving || !price}
          className="flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-3 h-7 text-xs ml-auto disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> :
           saved ? <CheckCircle2 className="h-3 w-3" /> :
           <Save className="h-3 w-3" />}
          {saved ? "Enregistré" : "Sauver"}
        </button>
      </td>
    </tr>
  );
}

function FruiteriePanel() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [jobs, setJobs] = useState<ImportJob[]>([]);

  const { data: ingredients = [] } = useQuery({
    queryKey: ["ingredients", search],
    queryFn: () => ingredientsApi.list({ search: search || undefined, limit: 100 }).then((r) => r.data),
  });

  const { data: products = [] } = useQuery({
    queryKey: ["fruiterie-products"],
    queryFn: () => storesApi.listProducts("fruiterie_440").then((r) => r.data),
    refetchInterval: jobs.some((j) => j.status === "running" || j.status === "queued") ? 5_000 : false,
  });

  const byIngredient = useMemo(() => {
    const map = new Map<number, StoreProduct>();
    for (const p of products) map.set(p.ingredient_master_id, p);
    return map;
  }, [products]);

  const save = async (data: Parameters<typeof storesApi.upsertPrice>[1]) => {
    await storesApi.upsertPrice("fruiterie_440", data);
    await qc.invalidateQueries({ queryKey: ["fruiterie-products"] });
  };

  const estimateAll = useMutation({
    mutationFn: () => storesApi.estimateFruiteriePrices(),
    onSuccess: (r) => setJobs((prev) => [r.data, ...prev]),
  });

  const estimatedCount = products.filter((p) => !p.is_validated && p.price != null).length;
  const validatedCount = products.filter((p) => p.is_validated).length;

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Leaf className="h-5 w-5 text-green-600" />
        <span className="font-semibold">Prix Fruiterie 440</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Gemini estime automatiquement les prix en vrac. Tu peux ensuite écraser manuellement
        chaque estimation ; les prix manuels passent en « validés » et ne seront plus écrasés.
      </p>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> Estimés IA
          </p>
          <p className="text-xl font-bold">{estimatedCount}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" /> Validés manuellement
          </p>
          <p className="text-xl font-bold">{validatedCount}</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => estimateAll.mutate()}
          disabled={estimateAll.isPending}
          className="flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 h-9 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {estimateAll.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Estimer tous les prix avec Gemini
        </button>
      </div>

      {jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((j) => (
            <PriceMappingJobCard key={j.id} job={j} />
          ))}
        </div>
      )}

      {estimateAll.isError && (
        <p className="text-sm text-destructive">
          Erreur : worker Celery / clé Gemini ?
        </p>
      )}

      <input
        type="text"
        placeholder="Rechercher un ingrédient..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
      />

      <div className="max-h-[500px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="text-left">
              <th className="py-2 pr-3">Ingrédient</th>
              <th className="py-2 pr-2">Prix ($)</th>
              <th className="py-2 pr-2">Format</th>
              <th className="py-2 pr-2">Unité</th>
              <th className="py-2 pr-2">Source</th>
              <th className="py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map((ing) => (
              <FruiteriePricingRow
                key={ing.id}
                ingredient={ing}
                product={byIngredient.get(ing.id)}
                onSave={save}
              />
            ))}
          </tbody>
        </table>
      </div>
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
        <h1 className="text-2xl font-bold tracking-tight">Paramètres</h1>
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
          <li><code className="text-xs bg-muted px-1 rounded">COSTCO_ENABLED</code> — Active le scraper Costco</li>
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
            <FruiteriePanel />
            <ClassifyPanel />
          </div>
        )}
      </div>
    </div>
  );
}
