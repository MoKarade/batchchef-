"use client";

import { useQuery } from "@tanstack/react-query";
import { statsApi } from "@/lib/api";
import { BookOpen, ChefHat, Package, Tag, ArrowRight } from "lucide-react";
import Link from "next/link";

export function Dashboard() {
  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => statsApi.get().then((r) => r.data),
    refetchInterval: 30_000,
  });

  const statCards = [
    {
      label: "Recettes",
      value: stats?.total_recipes ?? "—",
      sub: `${stats?.ai_done_recipes ?? 0} avec tags IA`,
      icon: BookOpen,
      color: "text-blue-500",
      href: "/recipes",
    },
    {
      label: "Ingrédients",
      value: stats?.total_ingredients ?? "—",
      sub: "référencés",
      icon: Tag,
      color: "text-purple-500",
      href: "/recipes",
    },
    {
      label: "Prix disponibles",
      value: stats?.priced_ingredients ?? "—",
      sub: "produits validés",
      icon: Package,
      color: "text-green-500",
      href: "/settings",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Bienvenue dans BatchChef — votre assistant batch cooking intelligent.
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {statCards.map(({ label, value, sub, icon: Icon, color, href }) => (
          <Link key={label} href={href}>
            <div className="rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-muted-foreground">{label}</span>
                <Icon className={`h-5 w-5 ${color}`} />
              </div>
              <p className="text-3xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground mt-1">{sub}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href="/imports">
          <div className="rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer flex items-center justify-between">
            <div>
              <p className="font-semibold">Importer des recettes</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Lancer le scraping Marmiton (43 492 URLs)
              </p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </div>
        </Link>

        <Link href="/batches/new">
          <div className="rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer flex items-center justify-between">
            <div>
              <p className="font-semibold">Générer un batch</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Sélectionner 3 recettes pour 20 portions
              </p>
            </div>
            <ChefHat className="h-5 w-5 text-primary" />
          </div>
        </Link>
      </div>
    </div>
  );
}
