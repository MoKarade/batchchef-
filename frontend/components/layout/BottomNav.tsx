"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, BookOpen, ShoppingBasket, Snowflake, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Mobile bottom-tab bar — 5 items (Tickets and Gérer compete for the 5th
 * slot; Tickets wins since receipts are the main mobile-use flow).
 * Desktop shows the narrow Sidebar instead (hidden via `md:hidden`).
 */
const TABS = [
  { href: "/planifier", label: "Plan", icon: CalendarDays },
  { href: "/recipes", label: "Recettes", icon: BookOpen },
  { href: "/batch", label: "Panier", icon: ShoppingBasket },
  { href: "/frigo", label: "Frigo", icon: Snowflake },
  { href: "/gerer", label: "Gérer", icon: Wrench },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/planifier") return pathname === "/" || pathname.startsWith("/planifier");
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <nav className="md:hidden sticky bottom-0 z-30 bg-card/95 backdrop-blur border-t border-border pb-safe">
      <div className="grid grid-cols-5 h-16">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
