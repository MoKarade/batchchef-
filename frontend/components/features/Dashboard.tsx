"use client";

import { useQuery } from "@tanstack/react-query";
import { statsApi, recipesApi, batchesApi, type RecipeBrief } from "@/lib/api";
import {
  BookOpen, ChefHat, Sprout, Upload, Sparkles, ArrowRight,
  Flame, Leaf, Star,
} from "lucide-react";
import Link from "next/link";
import { formatPrice, healthColor, mealTypeLabel } from "@/lib/utils";

/**
 * Landing page / "Planifier" home. Three zones:
 *   1. Hero — week framing + CTA primary (lancer un batch)
 *   2. Inspiration — 4 random recipe cards (mini-carousel) so the user
 *      always has something cooking-appealing on first load
 *   3. Stats ribbon — compact footer with the essentials
 */
export function Dashboard() {
  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => statsApi.get().then((r) => r.data),
    refetchInterval: 60_000,
  });

  const { data: featured } = useQuery({
    queryKey: ["inspiration-recipes"],
    queryFn: () =>
      recipesApi
        .list({ sort: "health_desc", has_price: "priced", limit: 4, offset: 0 })
        .then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const { data: batches } = useQuery({
    queryKey: ["batches"],
    queryFn: () => batchesApi.list().then((r) => r.data),
    staleTime: 60_000,
  });

  const latestBatch = batches?.[0];
  const pricedPct = stats && stats.total_ingredients
    ? Math.round((stats.priced_ingredients / stats.total_ingredients) * 100)
    : null;

  return (
    <div className="space-y-8">
      {/* ===== HERO ===== */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary/15 via-accent/30 to-secondary/10 p-6 sm:p-10">
        {/* Decorative blobs */}
        <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 h-56 w-56 rounded-full bg-primary/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-secondary/15 blur-3xl" />

        <div className="relative max-w-2xl">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">
            Cette semaine
          </p>
          <h1 className="title-serif text-4xl sm:text-5xl font-bold leading-[1.05] mt-2 text-foreground">
            Qu&apos;est-ce qu&apos;on <span className="text-primary">cuisine</span> cette semaine&nbsp;?
          </h1>
          <p className="mt-3 text-muted-foreground text-sm sm:text-base max-w-md">
            Choisis 3 recettes, génère ta liste de courses, prépare ton batch de la semaine.
            Simple.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/batches/new"
              className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 h-11 text-sm font-semibold shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 transition-all"
            >
              <ChefHat className="h-4 w-4" />
              Générer un batch
            </Link>
            <Link
              href="/recipes"
              className="inline-flex items-center gap-2 rounded-full bg-background/80 backdrop-blur border border-border px-5 h-11 text-sm font-semibold hover:bg-background transition-colors"
            >
              <BookOpen className="h-4 w-4" />
              Explorer les recettes
            </Link>
          </div>

          {/* Latest batch preview if any */}
          {latestBatch && (
            <Link
              href={`/batches/${latestBatch.id}`}
              className="group mt-6 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Ton dernier batch : <span className="font-semibold">{latestBatch.name || `#${latestBatch.id}`}</span>
              <ArrowRight className="h-3 w-3 group-hover:translate-x-1 transition-transform" />
            </Link>
          )}
        </div>
      </section>

      {/* ===== INSPIRATION ===== */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="title-serif text-2xl font-bold">Inspiration du jour</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Des recettes saines, avec prix — prêtes à aller dans ton panier
            </p>
          </div>
          <Link href="/recipes" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
            Tout voir <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {featured?.items?.slice(0, 4).map((r) => <MiniRecipeCard key={r.id} recipe={r} />)
            ?? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="aspect-[4/5] rounded-2xl bg-muted animate-pulse" />
            ))}
        </div>
      </section>

      {/* ===== STATS RIBBON ===== */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Recettes"
          value={stats?.total_recipes ?? "—"}
          sub={`${stats?.ai_done_recipes ?? 0} classées`}
          icon={BookOpen}
          href="/recipes"
          tint="primary"
        />
        <StatCard
          label="Ingrédients"
          value={stats?.total_ingredients ?? "—"}
          sub={`${stats?.priced_ingredients ?? 0} avec prix`}
          icon={Sprout}
          href="/ingredients"
          tint="secondary"
        />
        <StatCard
          label="Couverture prix"
          value={pricedPct != null ? `${pricedPct}%` : "—"}
          sub="des ingrédients"
          icon={Sparkles}
          href="/gerer/settings"
          tint="accent"
        />
        <StatCard
          label="Batches"
          value={batches?.length ?? "—"}
          sub="créés"
          icon={ChefHat}
          href="/batch"
          tint="primary"
        />
      </section>

      {/* ===== QUICK ACTIONS ===== */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Link
          href="/gerer/imports"
          className="group flex items-center justify-between gap-4 rounded-2xl border bg-card p-5 hover:border-primary/60 hover:shadow-md transition-all"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <p className="title-serif font-semibold">Importer des recettes</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Scraping Marmiton + standardisation IA + mapping prix
              </p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform shrink-0" />
        </Link>
        <Link
          href="/frigo"
          className="group flex items-center justify-between gap-4 rounded-2xl border bg-card p-5 hover:border-secondary/60 hover:shadow-md transition-all"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/10 text-secondary shrink-0">
              <Sprout className="h-5 w-5" />
            </div>
            <div>
              <p className="title-serif font-semibold">Mon frigo</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ce que tu as déjà, réduit automatiquement ta liste de courses
              </p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform shrink-0" />
        </Link>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  href,
  tint,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  tint: "primary" | "secondary" | "accent";
}) {
  const tintCls = tint === "primary"
    ? "text-primary bg-primary/10"
    : tint === "secondary"
    ? "text-secondary bg-secondary/10"
    : "text-foreground bg-accent/50";
  return (
    <Link
      href={href}
      className="group rounded-2xl border bg-card p-4 hover:shadow-md transition-all"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </span>
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${tintCls}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <p className="title-serif text-3xl font-bold leading-none">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
    </Link>
  );
}

function MiniRecipeCard({ recipe }: { recipe: RecipeBrief }) {
  const hasPrice = recipe.estimated_cost_per_portion != null && recipe.estimated_cost_per_portion > 0;
  return (
    <Link href={`/recipes/${recipe.id}`} className="group block h-full">
      <article className="relative h-full overflow-hidden rounded-2xl bg-card border border-border shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all">
        <div className="relative aspect-[4/5] overflow-hidden bg-muted">
          {recipe.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={recipe.image_url}
              alt={recipe.title}
              className="w-full h-full object-cover group-hover:scale-[1.05] transition-transform duration-500"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-5xl bg-gradient-to-br from-accent/40 to-muted">
              🍽️
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          {/* Top row: health + diet */}
          <div className="absolute top-2 right-2 flex items-center gap-1">
            {recipe.health_score != null && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-background/90 backdrop-blur px-1.5 py-0.5 text-[10px] font-bold shadow">
                <Star className={`h-2.5 w-2.5 ${healthColor(recipe.health_score)}`} />
                <span className={healthColor(recipe.health_score)}>{recipe.health_score.toFixed(1)}</span>
              </span>
            )}
          </div>
          <div className="absolute top-2 left-2 flex items-center gap-1">
            {recipe.is_vegetarian && (
              <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-secondary text-secondary-foreground shadow" title="Végétarien">
                <Leaf className="h-2.5 w-2.5" />
              </span>
            )}
            {recipe.is_spicy && (
              <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-destructive text-destructive-foreground shadow" title="Épicé">
                <Flame className="h-2.5 w-2.5" />
              </span>
            )}
          </div>
          {/* Bottom content over gradient */}
          <div className="absolute inset-x-0 bottom-0 p-3 text-white">
            <p className="title-serif text-sm font-semibold leading-tight line-clamp-2 drop-shadow">
              {recipe.title}
            </p>
            <div className="flex items-center justify-between mt-1.5 text-[10px]">
              {recipe.meal_type && (
                <span className="font-medium uppercase tracking-wide opacity-90">
                  {mealTypeLabel(recipe.meal_type)}
                </span>
              )}
              {hasPrice && (
                <span className="font-bold font-serif">
                  {formatPrice(recipe.estimated_cost_per_portion!)}
                </span>
              )}
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}
