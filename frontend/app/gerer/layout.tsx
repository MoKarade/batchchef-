"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sprout, Layers, Upload, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * /gerer — power-user admin area. Sub-nav with 4 tabs:
 *   - Catalogue  : canonical parents (ingredients catalogue)
 *   - Variantes  : raw Marmiton variants
 *   - Imports    : Marmiton bulk import job launcher
 *   - Paramètres : env + advanced tools
 */
const TABS = [
  { href: "/gerer/catalogue", label: "Catalogue", icon: Sprout },
  { href: "/gerer/variantes", label: "Variantes", icon: Layers },
  { href: "/gerer/imports", label: "Imports", icon: Upload },
  { href: "/gerer/settings", label: "Paramètres", icon: Settings2 },
] as const;

export default function GererLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="title-serif text-2xl font-bold">Gérer</h1>
      </div>
      <nav className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1 border-b border-border">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm whitespace-nowrap",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div>{children}</div>
    </div>
  );
}
