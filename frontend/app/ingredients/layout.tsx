"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sprout, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * /ingredients — two views in one navigable surface:
 *   - Catalogue (default)  : canonical parents (parent_id IS NULL).
 *                             The "cleaned" ingredients with prices + photos.
 *   - Variantes            : raw Marmiton inputs grouped under their parent.
 *                             The "messy" source data — good for auditing.
 *
 * Tabs at the top switch between the two views without leaving the page.
 */
const TABS = [
  {
    href: "/ingredients",
    exact: true,
    label: "Catalogue",
    subtitle: "aliments traités",
    icon: Sprout,
  },
  {
    href: "/ingredients/variantes",
    exact: false,
    label: "Variantes Marmiton",
    subtitle: "bruts",
    icon: Layers,
  },
] as const;

export default function IngredientsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-4">
      <nav className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1 border-b border-border">
        {TABS.map(({ href, exact, label, subtitle, icon: Icon }) => {
          const active = exact
            ? pathname === href
            : pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "inline-flex items-baseline gap-1.5 px-3 h-9 rounded-md text-sm whitespace-nowrap transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5 self-center" />
              <span className="font-medium">{label}</span>
              <span className={cn("text-[10px]", active ? "opacity-80" : "opacity-60")}>
                {subtitle}
              </span>
            </Link>
          );
        })}
      </nav>

      <div>{children}</div>
    </div>
  );
}
