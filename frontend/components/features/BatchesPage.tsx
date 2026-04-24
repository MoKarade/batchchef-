"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { batchesApi, type Batch } from "@/lib/api";
import { formatPrice } from "@/lib/utils";
import {
  ChefHat,
  Clock,
  ShoppingCart,
  Search,
  Users,
  CheckCircle2,
  Sparkles,
  Filter,
  SortAsc,
  X,
} from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Skeleton } from "@/components/shared/Skeleton";
import { EmptyState } from "@/components/shared/EmptyState";

// ── Status ──────────────────────────────────────────────────────────────────
const STATUS_META: Record<
  string,
  { label: string; cls: string; icon: typeof ChefHat }
> = {
  draft: { label: "Brouillon", cls: "bg-amber-100 text-amber-800", icon: Sparkles },
  shopping: { label: "Shopping", cls: "bg-blue-100 text-blue-800", icon: ShoppingCart },
  cooking: { label: "En cuisine", cls: "bg-orange-100 text-orange-800", icon: ChefHat },
  done: { label: "Terminé", cls: "bg-green-100 text-green-800", icon: CheckCircle2 },
};

const STATUSES_ORDER = ["draft", "shopping", "cooking", "done"] as const;
const SORT_OPTIONS = [
  { value: "date_desc", label: "Récent d'abord" },
  { value: "date_asc", label: "Ancien d'abord" },
  { value: "cost_desc", label: "Coût ↓" },
  { value: "cost_asc", label: "Coût ↑" },
  { value: "portions_desc", label: "Portions ↓" },
] as const;

type Sort = (typeof SORT_OPTIONS)[number]["value"];

// ── BatchCard ───────────────────────────────────────────────────────────────
function BatchCard({ batch }: { batch: Batch }) {
  const S = STATUS_META[batch.status] ?? STATUS_META.draft;
  const nbRecipes = batch.batch_recipes?.length ?? 0;
  const nbItems = batch.shopping_items?.length ?? 0;
  const nbPurchased = batch.shopping_items?.filter((i) => i.is_purchased).length ?? 0;
  const shopPct = nbItems ? Math.round((nbPurchased / nbItems) * 100) : 0;

  return (
    <article className="group rounded-xl border bg-card p-4 sm:p-5 hover:shadow-md transition-all">
      <header className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-2 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <ChefHat className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="title-serif font-bold truncate">
              {batch.name ?? `Batch #${batch.id}`}
            </h3>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
              <Clock className="h-3 w-3" />
              {format(new Date(batch.generated_at), "d MMM yyyy", { locale: fr })}
            </p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold shrink-0 ${S.cls}`}
        >
          <S.icon className="h-3 w-3" />
          {S.label}
        </span>
      </header>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <MetricChip
          icon={<Users className="h-3 w-3" />}
          label="Portions"
          value={batch.total_portions ?? batch.target_portions}
        />
        <MetricChip
          icon={<ChefHat className="h-3 w-3" />}
          label="Recettes"
          value={nbRecipes || "—"}
        />
        <MetricChip
          icon="$"
          label="Coût"
          value={formatPrice(batch.total_estimated_cost)}
        />
      </div>

      {nbItems > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
            <span>Liste de courses</span>
            <span>
              {nbPurchased}/{nbItems}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary to-secondary transition-all"
              style={{ width: `${shopPct}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Link
          href={`/shopping/${batch.id}`}
          className="flex-1 inline-flex items-center justify-center gap-1 rounded-full bg-primary text-primary-foreground px-3 h-8 text-xs font-semibold hover:bg-primary/90 transition"
        >
          <ShoppingCart className="h-3 w-3" /> Courses
        </Link>
        <Link
          href={`/batches/${batch.id}`}
          className="inline-flex items-center justify-center rounded-full border bg-background px-3 h-8 text-xs font-semibold hover:bg-accent transition"
        >
          Détails
        </Link>
      </div>
    </article>
  );
}

function MetricChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg bg-muted/40 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
        {typeof icon === "string" ? <span>{icon}</span> : icon}
        {label}
      </div>
      <p className="font-bold text-sm mt-0.5 truncate">{value}</p>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
export function BatchesListPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sort, setSort] = useState<Sort>("date_desc");

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ["batches"],
    queryFn: () => batchesApi.list().then((r) => r.data),
  });

  // Counts per status for filter tabs
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: batches.length };
    for (const s of STATUSES_ORDER) c[s] = 0;
    for (const b of batches) c[b.status] = (c[b.status] ?? 0) + 1;
    return c;
  }, [batches]);

  const filtered = useMemo(() => {
    let arr = batches;
    if (statusFilter !== "all") {
      arr = arr.filter((b) => b.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      arr = arr.filter(
        (b) =>
          (b.name ?? "").toLowerCase().includes(q) ||
          String(b.id).includes(q),
      );
    }
    arr = [...arr].sort((a, b) => {
      switch (sort) {
        case "date_desc":
          return +new Date(b.generated_at) - +new Date(a.generated_at);
        case "date_asc":
          return +new Date(a.generated_at) - +new Date(b.generated_at);
        case "cost_desc":
          return (b.total_estimated_cost ?? 0) - (a.total_estimated_cost ?? 0);
        case "cost_asc":
          return (a.total_estimated_cost ?? Infinity) - (b.total_estimated_cost ?? Infinity);
        case "portions_desc":
          return (b.total_portions ?? 0) - (a.total_portions ?? 0);
      }
    });
    return arr;
  }, [batches, statusFilter, search, sort]);

  return (
    <div className="space-y-5 max-w-4xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="title-serif text-3xl font-bold">Batch Cooking</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {batches.length} sessions de meal prep
          </p>
        </div>
        <Link
          href="/batches/new"
          className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 h-10 text-sm font-semibold shadow hover:shadow-md hover:-translate-y-0.5 transition"
        >
          <ChefHat className="h-4 w-4" />
          Nouveau batch
        </Link>
      </header>

      {/* Filter pills */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterPill
          active={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
          label={`Tous · ${counts.all}`}
        />
        {STATUSES_ORDER.map((s) => (
          <FilterPill
            key={s}
            active={statusFilter === s}
            onClick={() => setStatusFilter(s)}
            label={`${STATUS_META[s].label} · ${counts[s] ?? 0}`}
            disabled={counts[s] === 0}
          />
        ))}

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher..."
              className="h-8 w-40 sm:w-48 rounded-lg border bg-background pl-8 pr-8 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Effacer"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-8 rounded-lg border bg-background text-xs px-2 focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        batches.length === 0 ? (
          <EmptyState
            emoji="🍳"
            title="Aucun batch encore"
            message="Lance ton premier batch — l'algo choisit les recettes et génère la liste de courses."
            ctaLabel="Générer un batch"
            ctaHref="/batches/new"
          />
        ) : (
          <EmptyState
            icon={Filter}
            title="Aucun résultat"
            message="Aucun batch ne correspond à ces filtres."
            ctaLabel="Réinitialiser"
            ctaOnClick={() => {
              setSearch("");
              setStatusFilter("all");
            }}
          />
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((b) => (
            <BatchCard key={b.id} batch={b} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-8 rounded-full px-3 text-xs font-semibold transition ${
        active
          ? "bg-primary text-primary-foreground shadow"
          : "bg-card border hover:bg-accent"
      } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
    >
      {label}
    </button>
  );
}
