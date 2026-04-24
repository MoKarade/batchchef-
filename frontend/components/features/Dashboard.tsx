"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  statsApi,
  recipesApi,
  batchesApi,
  inventoryApi,
  chefApi,
  type RecipeBrief,
  type Batch,
  type InventoryItem,
  type FridgeSuggestion,
} from "@/lib/api";
import {
  BookOpen,
  ChefHat,
  Sprout,
  Upload,
  Sparkles,
  ArrowRight,
  Flame,
  Leaf,
  Star,
  Clock,
  ShoppingCart,
  Refrigerator,
  Zap,
  Heart,
  CheckCircle2,
  Receipt,
  CircleDollarSign,
} from "lucide-react";
import Link from "next/link";
import { format, differenceInDays } from "date-fns";
import { fr } from "date-fns/locale";
import { formatPrice, healthColor, categoryEmoji } from "@/lib/utils";

/**
 * Page « Planifier » — point d'entrée de l'app.
 *
 * Layout (en colonnes responsive) :
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  HERO — CTA + contexte dynamique                        │
 *   ├──────────────────────────┬──────────────────────────────┤
 *   │  DERNIER BATCH (2 cols)  │  FRIGO preview (1 col)       │
 *   ├──────────────────────────┴──────────────────────────────┤
 *   │  SUGGESTIONS : 4 cartes curatées (Rapide/Budget/…)      │
 *   ├─────────────────────────────────────────────────────────┤
 *   │  STATS avec barres de progression                       │
 *   ├─────────────────────────────────────────────────────────┤
 *   │  QUICK ACTIONS                                          │
 *   └─────────────────────────────────────────────────────────┘
 */
export function Dashboard() {
  // ── Data fetching ─────────────────────────────────────────────────────────
  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => statsApi.get().then((r) => r.data),
    refetchInterval: 60_000,
  });

  const { data: batches } = useQuery({
    queryKey: ["batches"],
    queryFn: () => batchesApi.list().then((r) => r.data),
    staleTime: 60_000,
  });

  const { data: inventory } = useQuery({
    queryKey: ["inventory"],
    queryFn: () => inventoryApi.list().then((r) => r.data),
    staleTime: 60_000,
  });

  // #23 — proactive suggestions from the fridge. Only query if there's
  // actually stuff in the fridge (otherwise the endpoint returns []).
  const hasInventory = (inventory?.length ?? 0) > 0;
  const { data: fridgeSuggest } = useQuery({
    queryKey: ["fridge-suggest"],
    queryFn: () => chefApi.suggestFromFridge(6, 0.5).then((r) => r.data),
    enabled: hasInventory,
    staleTime: 2 * 60_000,
  });

  // 4 requêtes parallèles — une par catégorie de suggestion.
  // NB: on NE filtre PAS par `has_price=priced` tant que le price mapping
  // n'a pas rempli `estimated_cost_per_portion` sur l'ensemble du catalogue
  // (aujourd'hui ce champ est toujours NULL → tout le filtre élimine tout).
  //
  // Pour éviter que chaque catégorie remonte les mêmes 3 recettes
  // (toutes health_score=9.5 → même tête de liste) on combine DIFFÉRENTS
  // sorts + un `offset` décalé par jour. Ça donne une rotation stable dans
  // la journée mais qui change d'un jour à l'autre.
  // `dayRotation` = jours depuis le 1er janvier. Sert de seed d'offset
  // pour faire tourner les suggestions : les 4 catégories affichent des
  // recettes différentes d'un jour à l'autre mais stables dans la journée.
  //
  // React 19 en mode strict interdit ``Date.now()`` dans le body d'un
  // composant ET dans un useEffect qui déclenche immédiatement un
  // setState. Le pattern correct ici : lazy init via useState. La fonction
  // passée à useState ne s'exécute qu'une fois, côté client, après
  // hydration — pas de flash SSR, pas de re-render boucle.
  const [dayRotation] = useState(() =>
    Math.floor(
      (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) /
        86_400_000,
    ),
  );

  // Rapide — tri par recency (id_desc) + filtre prep_time ≤ 30min
  //          offset=dayRotation*7 → ~1 page de décalage par semaine
  const { data: quickRecipes } = useQuery({
    queryKey: ["reco", "quick", dayRotation],
    queryFn: () =>
      recipesApi
        .list({
          sort: "id_desc",
          status: "ai_done",
          prep_time_max_min: 30,
          limit: 3,
          offset: (dayRotation * 7) % 500,
        })
        .then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  // Santé — tri par health_desc + offset décalé sur les 4 677 recettes hs>=7
  const { data: healthyRecipes } = useQuery({
    queryKey: ["reco", "health", dayRotation],
    queryFn: () =>
      recipesApi
        .list({
          sort: "health_desc",
          status: "ai_done",
          health_score_min: 7,
          limit: 3,
          offset: (dayRotation * 3) % 200,
        })
        .then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  // Végé — tri alphabétique pour varier des deux listes ci-dessus
  const { data: vegeRecipes } = useQuery({
    queryKey: ["reco", "vege", dayRotation],
    queryFn: () =>
      recipesApi
        .list({
          sort: "title_asc",
          status: "ai_done",
          tag: "vegetarian",
          limit: 3,
          offset: (dayRotation * 11) % 500,
        })
        .then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  // Nouveautés — vraiment les dernières ajoutées
  const { data: freshRecipes } = useQuery({
    queryKey: ["reco", "fresh"],
    queryFn: () =>
      recipesApi
        .list({ sort: "id_desc", status: "ai_done", limit: 3 })
        .then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  // ── Derived ───────────────────────────────────────────────────────────────
  const latestBatch = batches?.[0];
  const pricedPct =
    stats && stats.total_ingredients
      ? Math.round((stats.priced_ingredients / stats.total_ingredients) * 100)
      : 0;
  const aiDonePct =
    stats && stats.total_recipes
      ? Math.round((stats.ai_done_recipes / stats.total_recipes) * 100)
      : 0;

  return (
    <div className="space-y-6 sm:space-y-8">
      <HeroSection
        latestBatch={latestBatch}
        cookableCount={stats?.ai_done_recipes ?? 0}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LatestBatchCard batch={latestBatch} />
        </div>
        <FridgePreview items={inventory ?? []} />
      </div>

      {/* #23 — only show when the fridge actually has matches */}
      {fridgeSuggest && fridgeSuggest.suggestions.length > 0 && (
        <FridgeSuggestionsSection
          items={fridgeSuggest.suggestions}
          fridgeItems={fridgeSuggest.fridge_items}
        />
      )}

      <SuggestionsSection
        quick={quickRecipes?.items}
        fresh={freshRecipes?.items}
        healthy={healthyRecipes?.items}
        vege={vegeRecipes?.items}
      />

      <StatsPanel
        totalRecipes={stats?.total_recipes ?? 0}
        aiDone={stats?.ai_done_recipes ?? 0}
        aiDonePct={aiDonePct}
        totalIngredients={stats?.total_ingredients ?? 0}
        pricedIngredients={stats?.priced_ingredients ?? 0}
        pricedPct={pricedPct}
        batchCount={batches?.length ?? 0}
        inventoryCount={inventory?.length ?? 0}
      />

      <QuickActions />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  HERO
// ════════════════════════════════════════════════════════════════════════════
function HeroSection({
  latestBatch,
  cookableCount,
}: {
  latestBatch?: Batch;
  cookableCount: number;
}) {
  const daysSinceLastBatch = latestBatch
    ? differenceInDays(new Date(), new Date(latestBatch.generated_at))
    : null;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5) return "Bonne nuit";
    if (h < 12) return "Bon matin";
    if (h < 18) return "Bon après-midi";
    return "Bonsoir";
  })();

  return (
    <section className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary/15 via-accent/30 to-secondary/10 p-6 sm:p-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 h-56 w-56 rounded-full bg-primary/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-secondary/15 blur-3xl"
      />

      <div className="relative max-w-2xl">
        <p className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">
          <Sparkles className="h-3 w-3" />
          {greeting}
        </p>
        <h1 className="title-serif text-4xl sm:text-5xl font-bold leading-[1.05] mt-2 text-foreground">
          Qu&apos;est-ce qu&apos;on{" "}
          <span className="text-primary">cuisine</span> cette semaine&nbsp;?
        </h1>
        <p className="mt-3 text-muted-foreground text-sm sm:text-base max-w-md">
          {cookableCount > 0 ? (
            <>
              <span className="font-semibold text-foreground">
                {cookableCount.toLocaleString("fr-CA")}
              </span>{" "}
              recettes prêtes à être planifiées. Choisis, génère ta liste,
              cuisine.
            </>
          ) : (
            "Choisis 3 recettes, génère ta liste de courses, prépare ton batch de la semaine."
          )}
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
            Parcourir les recettes
          </Link>
        </div>

        {latestBatch && daysSinceLastBatch != null && (
          <p className="mt-6 text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Dernier batch&nbsp;:{" "}
            <span className="font-semibold text-foreground">
              {daysSinceLastBatch === 0
                ? "aujourd'hui"
                : daysSinceLastBatch === 1
                ? "hier"
                : `il y a ${daysSinceLastBatch} jours`}
            </span>
          </p>
        )}
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  DERNIER BATCH
// ════════════════════════════════════════════════════════════════════════════
function LatestBatchCard({ batch }: { batch?: Batch }) {
  if (!batch) {
    return (
      <div className="h-full rounded-3xl border border-dashed bg-card/50 p-6 flex flex-col items-center justify-center text-center">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-3">
          <ChefHat className="h-6 w-6" />
        </div>
        <p className="title-serif font-semibold">Aucun batch encore</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          Lance ton premier batch — l&apos;algo choisit les recettes et génère
          la liste de courses.
        </p>
        <Link
          href="/batches/new"
          className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          Commencer <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    );
  }

  const totalItems = batch.shopping_items?.length ?? 0;
  const purchasedItems = batch.shopping_items?.filter((i) => i.is_purchased).length ?? 0;
  const progressPct = totalItems ? Math.round((purchasedItems / totalItems) * 100) : 0;

  const STATUS_STYLE: Record<string, { label: string; cls: string; icon: typeof ChefHat }> = {
    draft: { label: "Brouillon", cls: "bg-amber-100 text-amber-800", icon: Sparkles },
    shopping: { label: "Shopping", cls: "bg-blue-100 text-blue-800", icon: ShoppingCart },
    cooking: { label: "En cuisine", cls: "bg-orange-100 text-orange-800", icon: ChefHat },
    done: { label: "Terminé", cls: "bg-green-100 text-green-800", icon: CheckCircle2 },
  };
  const S = STATUS_STYLE[batch.status] ?? STATUS_STYLE.draft;

  const recipes = (batch.batch_recipes ?? []).slice(0, 4);
  const extraRecipes = (batch.batch_recipes?.length ?? 0) - recipes.length;

  return (
    <article className="h-full rounded-3xl border bg-card p-5 sm:p-6 flex flex-col">
      <header className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Ton dernier batch
          </p>
          <h3 className="title-serif text-2xl font-bold mt-0.5 truncate">
            {batch.name ?? `Batch #${batch.id}`}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {format(new Date(batch.generated_at), "d MMMM yyyy", { locale: fr })}
          </p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${S.cls}`}
        >
          <S.icon className="h-3 w-3" />
          {S.label}
        </span>
      </header>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <KPI
          label="Portions"
          value={batch.total_portions ?? batch.target_portions}
          icon={<Heart className="h-3.5 w-3.5" />}
        />
        <KPI
          label="Coût total"
          value={formatPrice(batch.total_estimated_cost)}
          icon={<CircleDollarSign className="h-3.5 w-3.5" />}
        />
        <KPI
          label="Recettes"
          value={batch.batch_recipes?.length ?? 0}
          icon={<BookOpen className="h-3.5 w-3.5" />}
        />
      </div>

      {/* Shopping progress */}
      {totalItems > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="font-semibold">Liste de courses</span>
            <span className="text-muted-foreground">
              {purchasedItems} / {totalItems} achetés
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary to-secondary transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Recipe thumbnails */}
      {recipes.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-4">
          {recipes.map((br) => (
            <Link
              key={br.id}
              href={`/recipes/${br.recipe_id}`}
              className="relative h-14 w-14 rounded-xl overflow-hidden bg-muted shrink-0 hover:ring-2 hover:ring-primary/40 transition"
              title={br.recipe?.title}
            >
              {br.recipe?.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={br.recipe.image_url}
                  alt={br.recipe.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xl">
                  🍽️
                </div>
              )}
            </Link>
          ))}
          {extraRecipes > 0 && (
            <div className="h-14 w-14 rounded-xl bg-muted/50 border border-dashed flex items-center justify-center text-xs font-semibold text-muted-foreground">
              +{extraRecipes}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <footer className="mt-auto flex gap-2">
        <Link
          href={`/shopping/${batch.id}`}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground px-4 h-10 text-sm font-semibold hover:bg-primary/90 transition"
        >
          <ShoppingCart className="h-4 w-4" />
          Liste de courses
        </Link>
        <Link
          href={`/batches/${batch.id}`}
          className="inline-flex items-center justify-center gap-2 rounded-full border bg-background px-4 h-10 text-sm font-semibold hover:bg-accent transition"
        >
          Détails
        </Link>
      </footer>
    </article>
  );
}

function KPI({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-muted/50 p-2.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {icon}
        {label}
      </div>
      <p className="title-serif text-lg font-bold mt-0.5">{value}</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  APERÇU FRIGO
// ════════════════════════════════════════════════════════════════════════════
function FridgePreview({ items }: { items: InventoryItem[] }) {
  // Tri : expire bientôt d'abord, puis plus récents
  const sorted = [...items].sort((a, b) => {
    const aExp = a.expires_at ? new Date(a.expires_at).getTime() : Infinity;
    const bExp = b.expires_at ? new Date(b.expires_at).getTime() : Infinity;
    return aExp - bExp;
  });
  const preview = sorted.slice(0, 5);

  return (
    <article className="h-full rounded-3xl border bg-card p-5 flex flex-col">
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-secondary/15 text-secondary flex items-center justify-center">
            <Refrigerator className="h-4 w-4" />
          </div>
          <div>
            <h3 className="title-serif font-bold">Mon frigo</h3>
            <p className="text-[10px] text-muted-foreground">
              {items.length} {items.length > 1 ? "articles" : "article"}
            </p>
          </div>
        </div>
        <Link
          href="/frigo"
          className="text-xs text-primary hover:underline inline-flex items-center gap-0.5"
        >
          Voir <ArrowRight className="h-3 w-3" />
        </Link>
      </header>

      {items.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
          <div className="text-3xl mb-2">🧺</div>
          <p className="text-xs text-muted-foreground">
            Aucun article.
            <br />
            Scanne un ticket pour commencer.
          </p>
          <Link
            href="/receipts"
            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-secondary hover:underline"
          >
            <Receipt className="h-3 w-3" />
            Scanner un reçu
          </Link>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {preview.map((it) => {
            const daysLeft = it.expires_at
              ? differenceInDays(new Date(it.expires_at), new Date())
              : null;
            const urgent = daysLeft != null && daysLeft <= 2;
            return (
              <li
                key={it.id}
                className="flex items-center justify-between gap-2 text-xs rounded-lg px-2 py-1.5 bg-muted/40"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base">
                    {categoryEmoji(undefined)}
                  </span>
                  <span className="truncate font-medium">
                    {it.ingredient?.display_name_fr ?? "Article"}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-muted-foreground text-[11px]">
                    {it.quantity} {it.unit}
                  </span>
                  {daysLeft != null && (
                    <span
                      className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${
                        urgent
                          ? "bg-destructive/15 text-destructive"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {daysLeft < 0 ? "expiré" : `J-${daysLeft}`}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  FRIDGE SUGGESTIONS (item #23)
// ════════════════════════════════════════════════════════════════════════════
function FridgeSuggestionsSection({
  items,
  fridgeItems,
}: {
  items: FridgeSuggestion[];
  fridgeItems: string[];
}) {
  return (
    <section>
      <header className="flex items-end justify-between mb-3">
        <div>
          <h2 className="title-serif text-2xl font-bold flex items-center gap-2">
            <Refrigerator className="h-5 w-5 text-secondary" />
            Cuisine avec ton frigo
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Recettes réalisables avec ce que tu as déjà
            {fridgeItems.length > 0 && (
              <span className="ml-1 text-muted-foreground/80">
                ({fridgeItems.slice(0, 4).join(", ")}
                {fridgeItems.length > 4 && "…"})
              </span>
            )}
          </p>
        </div>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.slice(0, 6).map((s) => (
          <Link
            key={s.recipe_id}
            href={`/recipes/${s.recipe_id}`}
            className="group rounded-2xl border bg-card p-3 flex gap-3 hover:shadow-md transition-all"
          >
            {s.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={s.image_url}
                alt=""
                className="h-16 w-16 rounded-xl object-cover shrink-0 group-hover:scale-105 transition-transform"
                loading="lazy"
              />
            ) : (
              <div className="h-16 w-16 rounded-xl bg-muted flex items-center justify-center text-2xl shrink-0">
                🍽️
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm line-clamp-2 leading-tight">
                {s.title}
              </p>
              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground">
                <span
                  className={`inline-flex items-center gap-0.5 font-bold ${
                    s.match_pct >= 80
                      ? "text-green-600"
                      : s.match_pct >= 60
                      ? "text-amber-600"
                      : "text-muted-foreground"
                  }`}
                >
                  {s.match_pct}% match
                </span>
                {s.health_score != null && (
                  <span className={`inline-flex items-center gap-0.5 ${healthColor(s.health_score)}`}>
                    <Star className="h-2.5 w-2.5 fill-current" />
                    {s.health_score.toFixed(1)}
                  </span>
                )}
              </div>
              {s.missing.length > 0 && (
                <p className="text-[10px] text-muted-foreground mt-1 truncate">
                  Manque : {s.missing.slice(0, 3).join(", ")}
                  {s.missing.length > 3 && "…"}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  SUGGESTIONS (4 catégories)
// ════════════════════════════════════════════════════════════════════════════
function SuggestionsSection({
  quick,
  fresh,
  healthy,
  vege,
}: {
  quick?: RecipeBrief[];
  fresh?: RecipeBrief[];
  healthy?: RecipeBrief[];
  vege?: RecipeBrief[];
}) {
  const categories: {
    key: string;
    title: string;
    subtitle: string;
    icon: typeof Zap;
    tint: string;
    iconTint: string;
    href: string;
    items?: RecipeBrief[];
  }[] = [
    {
      key: "quick",
      title: "Rapide ce soir",
      subtitle: "Moins de 30 min de prep",
      icon: Zap,
      tint: "from-amber-500/15 to-amber-500/5",
      iconTint: "text-amber-600 bg-amber-500/15",
      href: "/recipes",
      items: quick,
    },
    {
      key: "health",
      title: "Santé +",
      subtitle: "Health-score 7 et plus",
      icon: Heart,
      tint: "from-rose-500/15 to-rose-500/5",
      iconTint: "text-rose-600 bg-rose-500/15",
      href: "/recipes",
      items: healthy,
    },
    {
      key: "vege",
      title: "Végé du jour",
      subtitle: "Sans viande ni poisson",
      icon: Leaf,
      tint: "from-green-500/15 to-green-500/5",
      iconTint: "text-green-700 bg-green-500/15",
      href: "/recipes",
      items: vege,
    },
    {
      key: "fresh",
      title: "Dernières ajoutées",
      subtitle: "Les nouveautés de ton catalogue",
      icon: Sparkles,
      tint: "from-sky-500/15 to-sky-500/5",
      iconTint: "text-sky-600 bg-sky-500/15",
      href: "/recipes",
      items: fresh,
    },
  ];

  return (
    <section>
      <header className="flex items-end justify-between mb-4">
        <div>
          <h2 className="title-serif text-2xl font-bold">
            Suggestions pour cette semaine
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            4 pistes curatées par l&apos;algo — rapide, santé, végé, nouveautés
          </p>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {categories.map(({ key, ...rest }) => (
          <SuggestionColumn key={key} {...rest} />
        ))}
      </div>
    </section>
  );
}

function SuggestionColumn({
  title,
  subtitle,
  icon: Icon,
  tint,
  iconTint,
  href,
  items,
}: {
  title: string;
  subtitle: string;
  icon: typeof Zap;
  tint: string;
  iconTint: string;
  href: string;
  items?: RecipeBrief[];
}) {
  return (
    <div className={`rounded-2xl border bg-gradient-to-b ${tint} p-4 flex flex-col`}>
      <header className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-2 min-w-0">
          <div
            className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${iconTint}`}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="title-serif font-bold text-sm leading-tight">{title}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
        </div>
        <Link
          href={href}
          className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
        >
          <ArrowRight className="h-3 w-3" />
        </Link>
      </header>

      <div className="space-y-2 flex-1">
        {items?.slice(0, 3).map((r) => <SuggestionRow key={r.id} recipe={r} />) ??
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-muted/40 animate-pulse" />
          ))}
      </div>
    </div>
  );
}

function SuggestionRow({ recipe }: { recipe: RecipeBrief }) {
  return (
    <Link
      href={`/recipes/${recipe.id}`}
      className="group flex items-center gap-3 rounded-xl bg-card/80 backdrop-blur p-2 hover:bg-card hover:shadow-sm transition-all"
    >
      <div className="relative h-12 w-12 rounded-lg overflow-hidden bg-muted shrink-0">
        {recipe.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={recipe.image_url}
            alt={recipe.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg">
            🍽️
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate leading-tight">
          {recipe.title}
        </p>
        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
          {recipe.health_score != null && (
            <span className={`inline-flex items-center gap-0.5 font-semibold ${healthColor(recipe.health_score)}`}>
              <Star className="h-2.5 w-2.5 fill-current" />
              {recipe.health_score.toFixed(1)}
            </span>
          )}
          {recipe.estimated_cost_per_portion != null &&
            recipe.estimated_cost_per_portion > 0 && (
              <span className="font-semibold text-foreground">
                {formatPrice(recipe.estimated_cost_per_portion)}
              </span>
            )}
          {recipe.is_vegetarian && (
            <Leaf className="h-2.5 w-2.5 text-green-600" />
          )}
          {recipe.is_spicy && <Flame className="h-2.5 w-2.5 text-destructive" />}
        </div>
      </div>
    </Link>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  STATS PANEL
// ════════════════════════════════════════════════════════════════════════════
function StatsPanel({
  totalRecipes,
  aiDone,
  aiDonePct,
  totalIngredients,
  pricedIngredients,
  pricedPct,
  batchCount,
  inventoryCount,
}: {
  totalRecipes: number;
  aiDone: number;
  aiDonePct: number;
  totalIngredients: number;
  pricedIngredients: number;
  pricedPct: number;
  batchCount: number;
  inventoryCount: number;
}) {
  return (
    <section>
      <header className="flex items-end justify-between mb-3">
        <div>
          <h2 className="title-serif text-2xl font-bold">Ta base de données</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Catalogue + ingrédients pricés + frigo
          </p>
        </div>
        <Link
          href="/gerer/settings"
          className="text-xs text-primary hover:underline inline-flex items-center gap-0.5"
        >
          Gérer <ArrowRight className="h-3 w-3" />
        </Link>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ProgressStat
          label="Recettes classées"
          icon={BookOpen}
          value={aiDone}
          total={totalRecipes}
          pct={aiDonePct}
          tint="primary"
          href="/recipes"
          note={`sur ${totalRecipes.toLocaleString("fr-CA")}`}
        />
        <ProgressStat
          label="Couverture prix"
          icon={CircleDollarSign}
          value={pricedIngredients}
          total={totalIngredients}
          pct={pricedPct}
          tint="secondary"
          href="/ingredients"
          note={`sur ${totalIngredients.toLocaleString("fr-CA")} ingr.`}
        />
        <SimpleStat
          label="Batches créés"
          icon={ChefHat}
          value={batchCount}
          sub="sessions de meal prep"
          href="/batches"
          tint="primary"
        />
        <SimpleStat
          label="Articles au frigo"
          icon={Refrigerator}
          value={inventoryCount}
          sub="réduisent ta liste de courses"
          href="/frigo"
          tint="secondary"
        />
      </div>
    </section>
  );
}

function ProgressStat({
  label,
  icon: Icon,
  value,
  pct,
  tint,
  href,
  note,
}: {
  label: string;
  icon: typeof BookOpen;
  value: number;
  /** Kept for future tooltip/density use; currently the pct is enough. */
  total: number;
  pct: number;
  tint: "primary" | "secondary";
  href: string;
  note: string;
}) {
  const tintBar =
    tint === "primary"
      ? "from-primary to-primary/70"
      : "from-secondary to-secondary/70";
  const tintIcon =
    tint === "primary"
      ? "text-primary bg-primary/10"
      : "text-secondary bg-secondary/10";

  return (
    <Link
      href={href}
      className="group rounded-2xl border bg-card p-4 hover:shadow-md transition-all"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </span>
        <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${tintIcon}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <p className="title-serif text-3xl font-bold leading-none flex items-baseline gap-1">
        {pct}
        <span className="text-xl text-muted-foreground">%</span>
      </p>
      <p className="text-[11px] text-muted-foreground mt-1">
        {value.toLocaleString("fr-CA")} {note}
      </p>
      <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${tintBar} transition-all`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </Link>
  );
}

function SimpleStat({
  label,
  icon: Icon,
  value,
  sub,
  href,
  tint,
}: {
  label: string;
  icon: typeof ChefHat;
  value: number;
  sub: string;
  href: string;
  tint: "primary" | "secondary";
}) {
  const tintIcon =
    tint === "primary"
      ? "text-primary bg-primary/10"
      : "text-secondary bg-secondary/10";
  return (
    <Link
      href={href}
      className="group rounded-2xl border bg-card p-4 hover:shadow-md transition-all"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </span>
        <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${tintIcon}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <p className="title-serif text-3xl font-bold leading-none">
        {value.toLocaleString("fr-CA")}
      </p>
      <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
    </Link>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  QUICK ACTIONS
// ════════════════════════════════════════════════════════════════════════════
function QuickActions() {
  const actions = [
    {
      href: "/receipts",
      title: "Scanner un reçu",
      subtitle: "OCR + mise à jour frigo automatique",
      icon: Receipt,
      tint: "primary" as const,
    },
    {
      href: "/gerer/imports",
      title: "Importer des recettes",
      subtitle: "Scraping Marmiton + IA",
      icon: Upload,
      tint: "secondary" as const,
    },
    {
      href: "/shopping",
      title: "Mes listes de courses",
      subtitle: "Toutes tes listes actives",
      icon: ShoppingCart,
      tint: "primary" as const,
    },
    {
      href: "/ingredients",
      title: "Base d'ingrédients",
      subtitle: "Catalogue + mapping prix",
      icon: Sprout,
      tint: "secondary" as const,
    },
  ];

  return (
    <section>
      <h2 className="title-serif text-2xl font-bold mb-3">Actions rapides</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className={`group flex items-center justify-between gap-3 rounded-2xl border bg-card p-4 hover:shadow-md hover:border-${a.tint}/60 transition-all`}
          >
            <div className="flex items-start gap-3 min-w-0">
              <div
                className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                  a.tint === "primary"
                    ? "bg-primary/10 text-primary"
                    : "bg-secondary/10 text-secondary"
                }`}
              >
                <a.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="title-serif font-semibold text-sm truncate">
                  {a.title}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                  {a.subtitle}
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform shrink-0" />
          </Link>
        ))}
      </div>
    </section>
  );
}
