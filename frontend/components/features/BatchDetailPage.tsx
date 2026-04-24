"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { batchesApi, type Batch } from "@/lib/api";
import { formatPrice } from "@/lib/utils";
import {
  ArrowLeft,
  ChefHat,
  ShoppingCart,
  Users,
  Pencil,
  Check,
  Copy,
  Trash2,
  Loader2,
  Sparkles,
  CheckCircle2,
  CircleDollarSign,
  BookOpen,
  NotebookPen,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import toast from "react-hot-toast";
import { RecipeModal } from "./RecipeModal";
import { Skeleton } from "@/components/shared/Skeleton";
import { useConfirm } from "@/components/shared/ConfirmDialog";
import { Tooltip } from "@/components/shared/Tooltip";

const STATUS_META: Record<
  string,
  { label: string; cls: string; icon: typeof ChefHat }
> = {
  draft: { label: "Brouillon", cls: "bg-amber-100 text-amber-800", icon: Sparkles },
  shopping: { label: "Shopping", cls: "bg-blue-100 text-blue-800", icon: ShoppingCart },
  cooking: { label: "En cuisine", cls: "bg-orange-100 text-orange-800", icon: ChefHat },
  done: { label: "Terminé", cls: "bg-green-100 text-green-800", icon: CheckCircle2 },
};

export function BatchDetailPage({ batchId }: { batchId: number }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [openRecipeId, setOpenRecipeId] = useState<number | null>(null);

  const { data: batch, isLoading } = useQuery({
    queryKey: ["batch", batchId],
    queryFn: () => batchesApi.get(batchId).then((r) => r.data),
  });

  const patchMut = useMutation({
    mutationFn: (data: Parameters<typeof batchesApi.patch>[1]) =>
      batchesApi.patch(batchId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batch", batchId] });
      qc.invalidateQueries({ queryKey: ["batches"] });
      toast.success("Modifications enregistrées");
    },
    onError: () => toast.error("Impossible de sauvegarder"),
  });

  const duplicateMut = useMutation({
    mutationFn: () => batchesApi.duplicate(batchId),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ["batches"] });
      toast.success(`Batch dupliqué → #${data.id}`);
      router.push(`/batches/${data.id}`);
    },
    onError: () => toast.error("Duplication impossible"),
  });

  const deleteMut = useMutation({
    mutationFn: () => batchesApi.delete(batchId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["batches"] });
      toast.success("Batch supprimé");
      router.push("/batches");
    },
    onError: () => toast.error("Suppression impossible"),
  });

  if (isLoading) {
    return (
      <div className="max-w-3xl space-y-4">
        <Skeleton className="h-32" />
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="h-60" />
      </div>
    );
  }
  if (!batch) {
    return <p className="text-sm text-muted-foreground">Batch introuvable.</p>;
  }

  const S = STATUS_META[batch.status] ?? STATUS_META.draft;

  const nbItems = batch.shopping_items?.length ?? 0;
  const nbPurchased = batch.shopping_items?.filter((i) => i.is_purchased).length ?? 0;
  const shopPct = nbItems ? Math.round((nbPurchased / nbItems) * 100) : 0;

  const handleDelete = async () => {
    if (
      await confirm({
        title: "Supprimer ce batch ?",
        message:
          "Cette action est irréversible. La liste de courses associée sera aussi supprimée.",
        destructive: true,
        confirmLabel: "Supprimer",
      })
    ) {
      deleteMut.mutate();
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <Link
        href="/batches"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Retour aux batches
      </Link>

      {/* ── Header card ───────────────────────────────────────── */}
      <div className="rounded-2xl border bg-card p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${S.cls}`}
              >
                <S.icon className="h-3 w-3" />
                {S.label}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {format(new Date(batch.generated_at), "d MMMM yyyy", { locale: fr })}
              </span>
            </div>

            <NameEditor
              key={`name-${batch.id}-${batch.name ?? ""}`}
              batch={batch}
              onSave={(name) => patchMut.mutate({ name })}
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Tooltip label="Reproduire ce batch">
              <button
                onClick={() => duplicateMut.mutate()}
                disabled={duplicateMut.isPending}
                className="h-9 w-9 rounded-lg border bg-background hover:bg-accent flex items-center justify-center disabled:opacity-50"
              >
                {duplicateMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </Tooltip>
            <Tooltip label="Supprimer">
              <button
                onClick={handleDelete}
                disabled={deleteMut.isPending}
                className="h-9 w-9 rounded-lg border border-destructive/40 text-destructive hover:bg-destructive/10 flex items-center justify-center disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </Tooltip>
            <Link
              href={`/shopping/${batch.id}`}
              className="h-9 rounded-full bg-primary text-primary-foreground px-4 text-xs font-semibold inline-flex items-center gap-1.5 shadow hover:shadow-md transition"
            >
              <ShoppingCart className="h-3.5 w-3.5" /> Courses
            </Link>
          </div>
        </div>

        {/* Status selector */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mr-2">
            Changer de statut
          </span>
          {(Object.keys(STATUS_META) as Array<keyof typeof STATUS_META>).map(
            (s) => (
              <button
                key={s}
                onClick={() => patchMut.mutate({ status: s })}
                disabled={batch.status === s || patchMut.isPending}
                className={`h-7 rounded-full px-2.5 text-[10px] font-semibold transition ${
                  batch.status === s
                    ? "bg-muted text-muted-foreground cursor-default"
                    : "bg-card border hover:bg-accent"
                }`}
              >
                {STATUS_META[s].label}
              </button>
            ),
          )}
        </div>
      </div>

      {/* ── KPIs ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi
          icon={<Users className="h-4 w-4" />}
          label="Portions"
          value={batch.total_portions ?? batch.target_portions}
        />
        <Kpi
          icon={<BookOpen className="h-4 w-4" />}
          label="Recettes"
          value={batch.batch_recipes?.length ?? 0}
        />
        <Kpi
          icon={<CircleDollarSign className="h-4 w-4" />}
          label="Coût estimé"
          value={formatPrice(batch.total_estimated_cost)}
        />
        <Kpi
          icon={<ShoppingCart className="h-4 w-4" />}
          label="Achats"
          value={`${nbPurchased}/${nbItems}`}
          progress={nbItems > 0 ? shopPct : undefined}
        />
      </div>

      {/* ── Recipes ───────────────────────────────────────────── */}
      <section>
        <h2 className="title-serif text-xl font-bold mb-3">Recettes</h2>
        <ul className="space-y-2">
          {batch.batch_recipes?.map((br) => (
            <li
              key={br.id}
              className="rounded-xl border bg-card p-3 flex items-center gap-3"
            >
              {br.recipe?.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={br.recipe.image_url}
                  alt=""
                  className="h-14 w-14 rounded-lg object-cover shrink-0"
                />
              ) : (
                <div className="h-14 w-14 rounded-lg bg-muted flex items-center justify-center text-xl shrink-0">
                  🍽️
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">
                  {br.recipe?.title ?? `Recette #${br.recipe_id}`}
                </p>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Users className="h-2.5 w-2.5" />
                  {br.portions} portions
                </p>
              </div>
              <button
                onClick={() => setOpenRecipeId(br.recipe_id)}
                className="text-xs px-3 h-8 rounded-lg border hover:bg-accent shrink-0"
              >
                Voir
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Notes ─────────────────────────────────────────────── */}
      <section>
        <header className="flex items-center gap-2 mb-2">
          <NotebookPen className="h-4 w-4 text-muted-foreground" />
          <h2 className="title-serif text-lg font-bold">Notes</h2>
        </header>
        <NotesEditor
          key={`notes-${batch.id}-${(batch.notes ?? "").length}`}
          initial={batch.notes ?? ""}
          onSave={(v) => patchMut.mutate({ notes: v })}
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Auto-sauvegardé à la sortie du champ
        </p>
      </section>

      <RecipeModal
        recipeId={openRecipeId}
        portions={
          batch.batch_recipes?.find((br) => br.recipe_id === openRecipeId)?.portions ??
          1
        }
        onClose={() => setOpenRecipeId(null)}
      />
      {dialog}
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  progress,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  progress?: number;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {icon}
        {label}
      </div>
      <p className="title-serif text-xl font-bold mt-0.5">{value}</p>
      {progress != null && (
        <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-secondary"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Inline name editor. Keyed by ``batch.id + current name`` in the parent so
 * a successful mutation re-mounts the component with the fresh value —
 * avoiding the "sync prop to state in useEffect" antipattern that React 19
 * strict mode flags as a render-loop risk.
 */
function NameEditor({
  batch,
  onSave,
}: {
  batch: Batch;
  onSave: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(batch.name ?? "");

  const save = () => {
    const clean = draft.trim();
    if (clean && clean !== batch.name) onSave(clean);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="mt-2 flex items-center gap-2 max-w-md">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          autoFocus
          placeholder={`Batch #${batch.id}`}
          className="title-serif text-2xl font-bold bg-transparent border-b-2 border-primary flex-1 min-w-0 focus:outline-none"
        />
        <Tooltip label="Enregistrer">
          <button
            onClick={save}
            className="h-8 w-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center"
          >
            <Check className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>
    );
  }
  return (
    <div className="mt-1 flex items-center gap-2 group">
      <h1 className="title-serif text-2xl sm:text-3xl font-bold truncate">
        {batch.name ?? `Batch #${batch.id}`}
      </h1>
      <Tooltip label="Renommer">
        <button
          onClick={() => setEditing(true)}
          className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * Auto-save textarea, same pattern as ``NameEditor`` — keyed by the parent
 * so a successful save re-mounts the component with the fresh server
 * value. No useEffect for state sync = React 19 strict-mode happy.
 */
function NotesEditor({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <textarea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value !== initial) onSave(value);
      }}
      placeholder="Observations sur ce batch : ajuster la recette de quiche, trop de sel sur le poulet, etc."
      rows={4}
      className="w-full rounded-xl border bg-card p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
    />
  );
}
