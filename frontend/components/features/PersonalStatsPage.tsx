"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { personalStatsApi } from "@/lib/api";
import { formatPrice } from "@/lib/utils";
import {
  TrendingUp,
  ChefHat,
  Users,
  CircleDollarSign,
  BookOpen,
  Calendar,
  Sparkles,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { Skeleton } from "@/components/shared/Skeleton";
import { EmptyState } from "@/components/shared/EmptyState";

/**
 * Personal stats — item #36.
 *
 * Hits /api/stats/personal which returns everything in one payload. All
 * aggregation is server-side so the client just renders.
 */
export function PersonalStatsPage() {
  const [window, setWindow] = useState<number>(90);

  const { data, isLoading } = useQuery({
    queryKey: ["personal-stats", window],
    queryFn: () => personalStatsApi.get(window).then((r) => r.data),
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3" />
            Mes statistiques
          </p>
          <h1 className="title-serif text-3xl sm:text-4xl font-bold mt-1">
            Tes habitudes de batch cooking
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sur les {window} derniers jours
          </p>
        </div>

        <div className="flex items-center gap-1">
          {[30, 90, 180, 365].map((d) => (
            <button
              key={d}
              onClick={() => setWindow(d)}
              className={`h-8 rounded-full px-3 text-xs font-semibold transition ${
                window === d
                  ? "bg-primary text-primary-foreground shadow"
                  : "bg-card border hover:bg-accent"
              }`}
            >
              {d}j
            </button>
          ))}
        </div>
      </header>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : data?.total_batches === 0 ? (
        <EmptyState
          emoji="📊"
          title="Pas encore de données"
          message={`Tu n'as pas créé de batch sur les ${window} derniers jours.`}
          ctaLabel="Créer mon premier batch"
          ctaHref="/batches/new"
        />
      ) : data ? (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi
              icon={<ChefHat className="h-4 w-4" />}
              label="Batches"
              value={data.total_batches}
              sub="sessions de meal prep"
              tint="primary"
            />
            <Kpi
              icon={<Users className="h-4 w-4" />}
              label="Portions"
              value={data.total_portions.toLocaleString("fr-CA")}
              sub={`${data.avg_portions_per_batch}/batch en moyenne`}
              tint="secondary"
            />
            <Kpi
              icon={<BookOpen className="h-4 w-4" />}
              label="Recettes uniques"
              value={data.total_recipes_unique}
              sub="cuisinées au moins 1 fois"
              tint="primary"
            />
            <Kpi
              icon={<CircleDollarSign className="h-4 w-4" />}
              label="Coût moyen"
              value={data.avg_cost_per_portion ? formatPrice(data.avg_cost_per_portion) : "—"}
              sub="par portion"
              tint="secondary"
            />
          </div>

          {/* Weekly sparkline */}
          <section>
            <header className="mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <h2 className="title-serif text-xl font-bold">
                Rythme hebdomadaire
              </h2>
            </header>
            <WeeklyBars weeks={data.weekly} />
          </section>

          {/* Top recipes */}
          <section>
            <header className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              <h2 className="title-serif text-xl font-bold">
                Tes recettes préférées
              </h2>
            </header>
            {data.top_recipes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Pas encore de tendance.</p>
            ) : (
              <ul className="space-y-2">
                {data.top_recipes.map((r, idx) => (
                  <li key={r.recipe_id}>
                    <Link
                      href={`/recipes/${r.recipe_id}`}
                      className="group flex items-center gap-3 rounded-xl border bg-card p-3 hover:shadow-md transition"
                    >
                      <div className="h-10 w-10 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center shrink-0">
                        #{idx + 1}
                      </div>
                      {r.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.image_url}
                          alt=""
                          className="h-12 w-12 rounded-lg object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center text-xl shrink-0">
                          🍽️
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
                          {r.title}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Utilisée {r.times_used}× · {r.total_portions} portions
                          cuisinées
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  tint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
  tint: "primary" | "secondary";
}) {
  const cls =
    tint === "primary"
      ? "text-primary bg-primary/10"
      : "text-secondary bg-secondary/10";
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </span>
        <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${cls}`}>
          {icon}
        </div>
      </div>
      <p className="title-serif text-2xl font-bold leading-none">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}

function WeeklyBars({
  weeks,
}: {
  weeks: { week_start: string; batches: number; portions: number }[];
}) {
  if (weeks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Aucune donnée hebdomadaire.</p>
    );
  }
  const maxB = Math.max(...weeks.map((w) => w.batches), 1);
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-end gap-1.5 h-32">
        {weeks.map((w) => {
          const h = (w.batches / maxB) * 100;
          return (
            <div
              key={w.week_start}
              className="flex-1 flex flex-col items-center gap-1 group"
            >
              <span className="text-[9px] font-semibold text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                {w.batches}
              </span>
              <div
                className="w-full rounded-t-md bg-gradient-to-t from-primary to-primary/60 transition-all hover:from-primary hover:to-primary/80"
                style={{ height: `${Math.max(h, 4)}%` }}
                title={`Semaine du ${format(parseISO(w.week_start), "d MMM", {
                  locale: fr,
                })} · ${w.batches} batches · ${w.portions} portions`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[9px] text-muted-foreground">
        <span>{format(parseISO(weeks[0].week_start), "d MMM", { locale: fr })}</span>
        <span>
          {format(parseISO(weeks[weeks.length - 1].week_start), "d MMM", {
            locale: fr,
          })}
        </span>
      </div>
    </div>
  );
}
