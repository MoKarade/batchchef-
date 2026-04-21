"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import {
  Search, CheckCircle2, AlertTriangle, Clock, Pencil, Check, X, RotateCcw,
  ChevronRight, Layers, List, ArrowLeft, Sparkles, Wrench,
} from "lucide-react";
import { ingredientsApi, type IngredientMaster } from "@/lib/api";
import { formatPrice, categoryEmoji, categoryLabel } from "@/lib/utils";

const STATUSES = [
  { value: "", label: "Tous les statuts" },
  { value: "mapped", label: "Mappés" },
  { value: "pending", label: "En attente" },
  { value: "failed", label: "Échec" },
] as const;

const PAGE_SIZE = 60;

function StatusBadge({ status }: { status: string }) {
  if (status === "mapped")
    return <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs"><CheckCircle2 className="h-3 w-3" /> Mappé</span>;
  if (status === "failed")
    return <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs"><AlertTriangle className="h-3 w-3" /> Échec</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs"><Clock className="h-3 w-3" /> En attente</span>;
}

function IngredientCard({
  ing,
  onDrillDown,
}: {
  ing: IngredientMaster;
  onDrillDown?: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(ing.display_name_fr);
  const [category, setCategory] = useState(ing.category ?? "");
  const [price, setPrice] = useState(ing.estimated_price_per_kg?.toString() ?? "");
  const childrenCount = ing.children_count ?? 0;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ingredients"] });
    qc.invalidateQueries({ queryKey: ["ingredients-count"] });
    qc.invalidateQueries({ queryKey: ["ingredient-categories"] });
  };

  const save = useMutation({
    mutationFn: () =>
      ingredientsApi.update(ing.id, {
        display_name_fr: name,
        category: category || undefined,
        estimated_price_per_kg: price ? parseFloat(price) : undefined,
      }),
    onSuccess: () => { invalidate(); setEditing(false); },
  });

  const unmap = useMutation({
    mutationFn: () => ingredientsApi.unmap(ing.id),
    onSuccess: invalidate,
  });

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="text-4xl leading-none shrink-0">{categoryEmoji(ing.category)}</div>
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-7 w-full rounded-md border bg-background px-2 text-sm font-semibold"
            />
          ) : (
            <p className="font-semibold text-sm truncate">{ing.display_name_fr}</p>
          )}
          <p className="text-[11px] text-muted-foreground font-mono truncate">{ing.canonical_name}</p>
        </div>
        <button
          onClick={() => setEditing((v) => !v)}
          className="h-7 w-7 rounded-md border hover:bg-accent inline-flex items-center justify-center shrink-0"
          aria-label="Éditer"
        >
          {editing ? <X className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-muted-foreground">Catégorie</p>
          {editing ? (
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="fruit, legume…"
              className="h-7 w-full rounded-md border bg-background px-2 text-xs mt-0.5"
            />
          ) : (
            <p className="font-medium">{categoryLabel(ing.category)}</p>
          )}
        </div>
        <div>
          <p className="text-muted-foreground">Prix estimé / kg</p>
          {editing ? (
            <input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="h-7 w-full rounded-md border bg-background px-2 text-xs mt-0.5"
            />
          ) : (
            <p className="font-medium">{formatPrice(ing.estimated_price_per_kg)}</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <StatusBadge status={ing.price_mapping_status} />
        <div className="text-[11px] text-muted-foreground flex items-center gap-2">
          {ing.usage_count != null && <span>{ing.usage_count} recettes</span>}
          {ing.store_product_count != null && <span>· {ing.store_product_count} prix</span>}
        </div>
      </div>

      {childrenCount > 0 && onDrillDown && (
        <button
          onClick={onDrillDown}
          className="w-full h-8 rounded-md border bg-muted/30 text-xs inline-flex items-center justify-between px-3 hover:bg-accent"
        >
          <span className="inline-flex items-center gap-1.5">
            <Layers className="h-3 w-3" /> {childrenCount} variante{childrenCount > 1 ? "s" : ""}
          </span>
          <ChevronRight className="h-3 w-3" />
        </button>
      )}

      {editing ? (
        <div className="flex items-center gap-2">
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="flex-1 h-8 rounded-md bg-primary text-primary-foreground text-xs font-medium inline-flex items-center justify-center gap-1 hover:opacity-90 disabled:opacity-50"
          >
            <Check className="h-3 w-3" /> {save.isPending ? "Enregistrement…" : "Enregistrer"}
          </button>
          {ing.price_mapping_status === "mapped" && (
            <button
              onClick={() => unmap.mutate()}
              disabled={unmap.isPending}
              title="Remettre en attente pour un nouveau mapping"
              className="h-8 px-2 rounded-md border text-xs inline-flex items-center gap-1 hover:bg-accent disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" /> Unmap
            </button>
          )}
        </div>
      ) : ing.price_mapping_status === "mapped" ? (
        <button
          onClick={() => unmap.mutate()}
          disabled={unmap.isPending}
          title="Remettre en attente pour un nouveau mapping"
          className="w-full h-7 rounded-md border text-[11px] inline-flex items-center justify-center gap-1 hover:bg-accent disabled:opacity-50"
        >
          <RotateCcw className="h-3 w-3" /> {unmap.isPending ? "…" : "Unmap"}
        </button>
      ) : null}
    </div>
  );
}

type ViewMode = "flat" | "hierarchy";
type Crumb = { id: number; label: string };

export function IngredientsPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("hierarchy");
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const currentParentId = crumbs[crumbs.length - 1]?.id;

  // In hierarchy mode, drilled-in → children of currentParentId; root → only top-level.
  // In flat mode, ignore parent entirely.
  const parentFilter: string | number | undefined =
    viewMode === "flat"
      ? undefined
      : currentParentId !== undefined
      ? currentParentId
      : "null";

  const filters = { search, category, status, parentFilter };

  const drillDown = (ing: IngredientMaster) => {
    setCrumbs((cs) => [...cs, { id: ing.id, label: ing.display_name_fr }]);
  };
  const goUp = (index: number) => {
    setCrumbs((cs) => cs.slice(0, index));
  };

  const qc = useQueryClient();
  const sanitize = useMutation({
    mutationFn: () => ingredientsApi.sanitizeNames(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ingredients"] });
      qc.invalidateQueries({ queryKey: ["ingredients-count"] });
    },
  });
  const repair = useMutation({
    mutationFn: () => ingredientsApi.repairPrefixes().then((r) => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["ingredients"] });
      qc.invalidateQueries({ queryKey: ["ingredients-count"] });
      alert(
        `Réparation : ${res.scanned} scannés, ${res.renamed} renommés, ${res.merged} fusionnés, ${res.skipped} ignorés.`,
      );
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["ingredient-categories"],
    queryFn: () => ingredientsApi.categories().then((r) => r.data),
    staleTime: 60_000,
  });

  const { data: totalCount = 0 } = useQuery({
    queryKey: ["ingredients-count", filters],
    queryFn: () =>
      ingredientsApi
        .count({
          search: search || undefined,
          category: category || undefined,
          price_mapping_status: status || undefined,
          parent_id: parentFilter,
        })
        .then((r) => r.data),
  });

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["ingredients", filters],
    initialPageParam: 0,
    queryFn: ({ pageParam = 0 }) =>
      ingredientsApi
        .list({
          search: search || undefined,
          category: category || undefined,
          price_mapping_status: status || undefined,
          parent_id: parentFilter,
          limit: PAGE_SIZE,
          offset: pageParam,
        })
        .then((r) => r.data),
    getNextPageParam: (last, pages) => {
      if (!last || last.length < PAGE_SIZE) return undefined;
      return pages.reduce((acc, p) => acc + p.length, 0);
    },
  });

  const ingredients = useMemo(() => data?.pages.flat() ?? [], [data]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const counts = useMemo(() => {
    const c = { mapped: 0, pending: 0, failed: 0 };
    for (const i of ingredients) {
      if (i.price_mapping_status === "mapped") c.mapped++;
      else if (i.price_mapping_status === "failed") c.failed++;
      else c.pending++;
    }
    return c;
  }, [ingredients]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ingrédients</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {totalCount.toLocaleString("fr-CA")} ingrédients
            {ingredients.length < totalCount && ` (${ingredients.length} chargés)`}
            {" — "}
            <span className="text-green-700">{counts.mapped} mappés</span>
            {", "}
            <span className="text-amber-700">{counts.pending} en attente</span>
            {counts.failed > 0 && (<>{" , "}<span className="text-red-700">{counts.failed} échec</span></>)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => repair.mutate()}
            disabled={repair.isPending}
            title="Supprime les préfixes '-1 ', '-134 ', etc. et fusionne les doublons"
            className="h-8 px-3 rounded-md border text-xs inline-flex items-center gap-1.5 hover:bg-accent disabled:opacity-50"
          >
            <Wrench className="h-3 w-3" />
            {repair.isPending ? "Réparation…" : "Réparer les préfixes"}
          </button>
          <button
            onClick={() => sanitize.mutate()}
            disabled={sanitize.isPending}
            title="Relance Gemini pour corriger les noms corrompus"
            className="h-8 px-3 rounded-md border text-xs inline-flex items-center gap-1.5 hover:bg-accent disabled:opacity-50"
          >
            <Sparkles className="h-3 w-3" />
            {sanitize.isPending ? "Lancement…" : "Nettoyer les noms"}
          </button>
          <div className="inline-flex rounded-md border overflow-hidden text-xs">
            <button
              onClick={() => { setViewMode("hierarchy"); setCrumbs([]); }}
              className={`px-3 h-8 inline-flex items-center gap-1 ${
                viewMode === "hierarchy" ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              }`}
            >
              <Layers className="h-3 w-3" /> Hiérarchie
            </button>
            <button
              onClick={() => { setViewMode("flat"); setCrumbs([]); }}
              className={`px-3 h-8 inline-flex items-center gap-1 border-l ${
                viewMode === "flat" ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              }`}
            >
              <List className="h-3 w-3" /> Tous
            </button>
          </div>
        </div>
      </div>

      {viewMode === "hierarchy" && crumbs.length > 0 && (
        <div className="flex items-center gap-1 text-sm flex-wrap">
          <button
            onClick={() => goUp(0)}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md border hover:bg-accent"
          >
            <ArrowLeft className="h-3 w-3" /> Racine
          </button>
          {crumbs.map((c, i) => (
            <div key={c.id} className="inline-flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <button
                onClick={() => goUp(i + 1)}
                disabled={i === crumbs.length - 1}
                className="h-7 px-2 rounded-md hover:bg-accent disabled:font-semibold disabled:hover:bg-transparent"
              >
                {c.label}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            placeholder="Rechercher un ingrédient…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 py-1 text-sm"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Toutes les catégories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{categoryEmoji(c)} {categoryLabel(c)}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-card h-40 animate-pulse" />
          ))}
        </div>
      ) : ingredients.length === 0 ? (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          Aucun ingrédient ne correspond à ces filtres.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {ingredients.map((ing) => (
              <IngredientCard
                key={ing.id}
                ing={ing}
                onDrillDown={viewMode === "hierarchy" ? () => drillDown(ing) : undefined}
              />
            ))}
          </div>
          <div ref={sentinelRef} className="h-10 flex items-center justify-center text-xs text-muted-foreground">
            {isFetchingNextPage
              ? "Chargement…"
              : hasNextPage
              ? "Faites défiler pour charger la suite"
              : ingredients.length > PAGE_SIZE
              ? "Tous les ingrédients sont chargés."
              : ""}
          </div>
        </>
      )}
    </div>
  );
}
