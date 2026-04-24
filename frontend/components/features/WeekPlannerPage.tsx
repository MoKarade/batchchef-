"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  mealPlansApi,
  recipesApi,
  type MealPlan,
  type PlannedMeal,
  type RecipeBrief,
} from "@/lib/api";
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import Link from "next/link";
import toast from "react-hot-toast";
import { format, addDays, addWeeks, startOfWeek, isSameWeek } from "date-fns";
import { fr } from "date-fns/locale";
import {
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  Search,
  ShoppingCart,
  Users,
  Leaf,
  Flame,
  Star,
  Calendar,
  Sparkles,
} from "lucide-react";
import { healthColor } from "@/lib/utils";

type Slot = "midi" | "soir" | "snack";
const SLOTS: { key: Slot; label: string; emoji: string }[] = [
  { key: "midi", label: "Midi", emoji: "☀️" },
  { key: "soir", label: "Soir", emoji: "🌙" },
  { key: "snack", label: "Snack", emoji: "🍪" },
];

const DAY_LABELS_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const DAY_LABELS_LONG = [
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
];

/**
 * Trello-style weekly meal planner — 7 columns (days) × 3 rows (slots).
 *
 * Data model:
 *   - One MealPlan per week (Monday-indexed). /current auto-creates the
 *     current-week plan so the board is never empty.
 *   - Each card = a PlannedMeal entry. Drag-drop between any cell updates
 *     its (day_of_week, meal_slot, position) via PATCH.
 *
 * UX choices:
 *   - DnD uses pointer sensor with a small activation distance so a click
 *     on the card still opens the recipe detail instead of starting a drag.
 *   - A "+" button in every empty slot opens a recipe picker modal.
 *   - Top bar: week navigation (prev/today/next) + "Générer la liste de
 *     courses" which converts the plan to a Batch.
 */
export function WeekPlannerPage() {
  const qc = useQueryClient();
  const [currentWeekStart, setCurrentWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [pickerCell, setPickerCell] = useState<{ day: number; slot: Slot } | null>(null);
  const [draggingEntry, setDraggingEntry] = useState<PlannedMeal | null>(null);

  const weekIso = format(currentWeekStart, "yyyy-MM-dd");

  // Current-week plan auto-creates itself. For other weeks we explicit-create.
  const { data: plan, isLoading } = useQuery({
    queryKey: ["meal-plan", weekIso],
    queryFn: async () => {
      // If we're on the current ISO week, hit /current (server-side auto-create)
      const isThisWeek = isSameWeek(currentWeekStart, new Date(), {
        weekStartsOn: 1,
      });
      if (isThisWeek) return mealPlansApi.current().then((r) => r.data);
      // Otherwise POST with the target Monday — the endpoint is idempotent.
      return mealPlansApi.create({ week_start_date: weekIso }).then((r) => r.data);
    },
  });

  const moveMut = useMutation({
    mutationFn: ({
      entryId,
      day,
      slot,
    }: {
      entryId: number;
      day: number;
      slot: Slot;
    }) =>
      mealPlansApi.moveEntry(plan!.id, entryId, {
        day_of_week: day,
        meal_slot: slot,
      }),
    onMutate: async ({ entryId, day, slot }) => {
      // Optimistic update — the drag ends visually right away.
      await qc.cancelQueries({ queryKey: ["meal-plan", weekIso] });
      const prev = qc.getQueryData<MealPlan>(["meal-plan", weekIso]);
      if (prev) {
        const updated: MealPlan = {
          ...prev,
          entries: prev.entries.map((e) =>
            e.id === entryId ? { ...e, day_of_week: day, meal_slot: slot } : e,
          ),
        };
        qc.setQueryData(["meal-plan", weekIso], updated);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["meal-plan", weekIso], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["meal-plan", weekIso] }),
  });

  const removeMut = useMutation({
    mutationFn: (entryId: number) => mealPlansApi.removeEntry(plan!.id, entryId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meal-plan", weekIso] }),
  });

  const toBatchMut = useMutation({
    mutationFn: () => mealPlansApi.toBatch(plan!.id),
    onSuccess: ({ data }) => {
      window.location.href = `/batches/${data.batch_id}`;
    },
  });

  // ── Drag sensors ──────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }, // 6px before a drag starts — clicks still fire
    }),
  );

  const handleDragStart = (ev: DragStartEvent) => {
    const id = Number(ev.active.id);
    const entry = plan?.entries.find((e) => e.id === id);
    setDraggingEntry(entry ?? null);
  };

  const handleDragEnd = useCallback(
    (ev: DragEndEvent) => {
      setDraggingEntry(null);
      const { active, over } = ev;
      if (!over || !plan) return;
      const [overDayStr, overSlot] = String(over.id).split(":");
      const overDay = Number(overDayStr);
      const entryId = Number(active.id);
      const entry = plan.entries.find((e) => e.id === entryId);
      if (!entry) return;
      if (entry.day_of_week === overDay && entry.meal_slot === overSlot) return;
      moveMut.mutate({ entryId, day: overDay, slot: overSlot as Slot });
    },
    [plan, moveMut],
  );

  // ── Layout helpers ────────────────────────────────────────────────────────
  const entriesByCell = new Map<string, PlannedMeal[]>();
  for (const e of plan?.entries ?? []) {
    const key = `${e.day_of_week}:${e.meal_slot}`;
    if (!entriesByCell.has(key)) entriesByCell.set(key, []);
    entriesByCell.get(key)!.push(e);
  }

  const totalPortions = plan?.entries.reduce((s, e) => s + e.portions, 0) ?? 0;
  const totalRecipes = new Set(plan?.entries.map((e) => e.recipe_id) ?? []).size;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold flex items-center gap-1.5">
            <Calendar className="h-3 w-3" />
            Planificateur hebdo
          </p>
          <h1 className="title-serif text-3xl sm:text-4xl font-bold leading-tight mt-1">
            Semaine du{" "}
            <span className="text-primary">
              {format(currentWeekStart, "d MMMM", { locale: fr })}
            </span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {totalRecipes} recettes planifiées · {totalPortions} portions au total
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentWeekStart((d) => addWeeks(d, -1))}
            className="h-9 w-9 rounded-lg border bg-card hover:bg-accent flex items-center justify-center transition-colors"
            title="Semaine précédente"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() =>
              setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))
            }
            className="h-9 rounded-lg border bg-card hover:bg-accent px-3 text-xs font-medium"
          >
            Aujourd&apos;hui
          </button>
          <button
            onClick={() => setCurrentWeekStart((d) => addWeeks(d, 1))}
            className="h-9 w-9 rounded-lg border bg-card hover:bg-accent flex items-center justify-center transition-colors"
            title="Semaine suivante"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            disabled={!plan || plan.entries.length === 0 || toBatchMut.isPending}
            onClick={() => toBatchMut.mutate()}
            className="ml-2 h-9 rounded-full bg-primary text-primary-foreground px-4 text-xs font-semibold shadow hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5 transition"
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            {toBatchMut.isPending ? "Création..." : "Générer liste de courses"}
          </button>
        </div>
      </header>

      {/* ── Board ──────────────────────────────────────────────────── */}
      {isLoading ? (
        <BoardSkeleton />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="overflow-x-auto -mx-4 px-4 pb-2">
            <div className="grid grid-cols-7 gap-2 min-w-[1000px]">
              {/* Day headers */}
              {Array.from({ length: 7 }).map((_, day) => {
                const d = addDays(currentWeekStart, day);
                const isToday =
                  format(d, "yyyy-MM-dd") ===
                  format(new Date(), "yyyy-MM-dd");
                return (
                  <div
                    key={`h-${day}`}
                    className={`text-center py-2 rounded-xl ${
                      isToday
                        ? "bg-primary/10 text-primary font-bold"
                        : "bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    <p className="text-[10px] uppercase tracking-wider">
                      {DAY_LABELS_SHORT[day]}
                    </p>
                    <p className="title-serif text-xl leading-none mt-0.5">
                      {format(d, "d")}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* 3 rows × 7 days of cells */}
            {SLOTS.map((slot) => (
              <div
                key={slot.key}
                className="grid grid-cols-7 gap-2 min-w-[1000px] mt-2"
              >
                {Array.from({ length: 7 }).map((_, day) => {
                  const cellEntries =
                    entriesByCell.get(`${day}:${slot.key}`) ?? [];
                  return (
                    <DayCell
                      key={`${day}-${slot.key}`}
                      day={day}
                      slot={slot.key}
                      slotLabel={slot.label}
                      slotEmoji={slot.emoji}
                      entries={cellEntries}
                      onAdd={() => setPickerCell({ day, slot: slot.key })}
                      onRemove={(id) => removeMut.mutate(id)}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          <DragOverlay>
            {draggingEntry ? (
              <MealCard entry={draggingEntry} onRemove={() => {}} dragging />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* ── Recipe picker modal ────────────────────────────────────── */}
      {pickerCell && plan && (
        <RecipePickerModal
          onClose={() => setPickerCell(null)}
          onPick={async (recipe) => {
            try {
              await mealPlansApi.addEntry(plan.id, {
                recipe_id: recipe.id,
                day_of_week: pickerCell.day,
                meal_slot: pickerCell.slot,
              });
              qc.invalidateQueries({ queryKey: ["meal-plan", weekIso] });
              toast.success(`${recipe.title} ajoutée`);
              setPickerCell(null);
            } catch (err: unknown) {
              // Most likely: backend routes not yet reloaded (404) or DB lock
              const status = (err as { response?: { status?: number } })?.response?.status;
              if (status === 404) {
                toast.error(
                  "API planif indisponible — redémarre uvicorn pour charger les nouvelles routes",
                );
              } else {
                toast.error("Impossible d'ajouter la recette");
              }
              console.error("addEntry failed:", err);
            }
          }}
          title={`${DAY_LABELS_LONG[pickerCell.day]} · ${
            SLOTS.find((s) => s.key === pickerCell.slot)?.label
          }`}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  DAY CELL — droppable container
// ════════════════════════════════════════════════════════════════════════════
function DayCell({
  day,
  slot,
  slotLabel,
  slotEmoji,
  entries,
  onAdd,
  onRemove,
}: {
  day: number;
  slot: Slot;
  slotLabel: string;
  slotEmoji: string;
  entries: PlannedMeal[];
  onAdd: () => void;
  onRemove: (entryId: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${day}:${slot}` });
  const isEmpty = entries.length === 0;

  return (
    <div
      ref={setNodeRef}
      className={`relative rounded-xl border-2 border-dashed transition-all min-h-[130px] p-1.5 flex flex-col gap-1.5 ${
        isOver
          ? "border-primary bg-primary/5"
          : isEmpty
          ? "border-border bg-muted/20"
          : "border-transparent bg-card/50"
      }`}
    >
      {/* Slot label badge (only on first row; let the design breathe) */}
      <div className="absolute top-1.5 left-2 text-[9px] uppercase tracking-wider text-muted-foreground/60 pointer-events-none">
        <span className="mr-1">{slotEmoji}</span>
        {slotLabel}
      </div>

      <div className="flex-1 space-y-1.5 mt-5">
        {entries.map((e) => (
          <MealCard key={e.id} entry={e} onRemove={() => onRemove(e.id)} />
        ))}
      </div>

      <button
        onClick={onAdd}
        className="group h-7 rounded-lg border border-dashed border-border text-[11px] font-medium text-muted-foreground hover:text-primary hover:border-primary hover:bg-primary/5 flex items-center justify-center gap-1 transition-colors"
        aria-label="Ajouter une recette"
      >
        <Plus className="h-3 w-3" />
        Ajouter
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  MEAL CARD — draggable
// ════════════════════════════════════════════════════════════════════════════
function MealCard({
  entry,
  onRemove,
  dragging = false,
}: {
  entry: PlannedMeal;
  onRemove: () => void;
  dragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: entry.id,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const recipe = entry.recipe;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group relative rounded-lg bg-card border shadow-sm hover:shadow-md cursor-grab active:cursor-grabbing transition-all ${
        isDragging ? "opacity-40" : ""
      } ${dragging ? "ring-2 ring-primary shadow-lg" : ""}`}
    >
      <div className="flex items-center gap-1.5 p-1.5">
        {recipe?.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={recipe.image_url}
            alt=""
            className="h-10 w-10 rounded object-cover shrink-0"
            loading="lazy"
          />
        ) : (
          <div className="h-10 w-10 rounded bg-muted flex items-center justify-center text-base shrink-0">
            🍽️
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold leading-tight line-clamp-2">
            {recipe?.title ?? `Recette #${entry.recipe_id}`}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5 text-[9px] text-muted-foreground">
            <Users className="h-2.5 w-2.5" />
            {entry.portions}
            {recipe?.health_score != null && (
              <span
                className={`inline-flex items-center gap-0.5 font-semibold ${healthColor(
                  recipe.health_score,
                )}`}
              >
                <Star className="h-2.5 w-2.5 fill-current" />
                {recipe.health_score.toFixed(1)}
              </span>
            )}
            {recipe?.is_vegetarian && (
              <Leaf className="h-2.5 w-2.5 text-green-600" />
            )}
            {recipe?.is_spicy && (
              <Flame className="h-2.5 w-2.5 text-destructive" />
            )}
          </div>
        </div>

        {/* Remove button — stops propagation so it doesn't trigger drag */}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="h-5 w-5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Retirer"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  RECIPE PICKER MODAL
// ════════════════════════════════════════════════════════════════════════════
function RecipePickerModal({
  title,
  onClose,
  onPick,
}: {
  title: string;
  onClose: () => void;
  onPick: (recipe: RecipeBrief) => void;
}) {
  const [query, setQuery] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["picker-recipes", query],
    queryFn: () =>
      recipesApi
        .list({
          search: query || undefined,
          status: "ai_done",
          sort: query ? "title_asc" : "health_desc",
          limit: 24,
        })
        .then((r) => r.data),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-2xl bg-background rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="p-4 border-b flex items-center justify-between shrink-0">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold inline-flex items-center gap-1">
              <Sparkles className="h-2.5 w-2.5" />
              Ajouter à
            </p>
            <h3 className="title-serif text-lg font-bold mt-0.5">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg border hover:bg-accent flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="p-4 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Chercher une recette..."
              className="w-full h-10 pl-9 pr-3 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : (data?.items?.length ?? 0) === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-12">
              Aucune recette trouvée.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {data?.items.map((r) => (
                <button
                  key={r.id}
                  onClick={() => onPick(r)}
                  className="group rounded-xl overflow-hidden bg-card border hover:border-primary hover:shadow-md text-left transition-all"
                >
                  <div className="aspect-[4/3] bg-muted relative">
                    {r.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.image_url}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-3xl">
                        🍽️
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-[11px] font-semibold leading-tight line-clamp-2">
                      {r.title}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1 text-[9px] text-muted-foreground">
                      {r.health_score != null && (
                        <span
                          className={`inline-flex items-center gap-0.5 font-semibold ${healthColor(
                            r.health_score,
                          )}`}
                        >
                          <Star className="h-2 w-2 fill-current" />
                          {r.health_score.toFixed(1)}
                        </span>
                      )}
                      {r.is_vegetarian && (
                        <Leaf className="h-2 w-2 text-green-600" />
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <footer className="p-3 border-t text-[10px] text-center text-muted-foreground shrink-0">
          <Link href="/recipes" className="hover:underline">
            Explorer tout le catalogue →
          </Link>
        </footer>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  SKELETON
// ════════════════════════════════════════════════════════════════════════════
function BoardSkeleton() {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid grid-cols-7 gap-2 min-w-[1000px]">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-[400px] rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    </div>
  );
}
