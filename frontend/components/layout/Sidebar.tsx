"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays, BookOpen, ShoppingBasket, Snowflake, Receipt, Wrench,
  ChefHat, Sprout,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";
import { useCart } from "@/lib/cart";

/**
 * V3 navigation — 6 paradigms composed into one app:
 *   - Planifier   : weekly calendar home (#5 calendar, #2 kanban toggle)
 *   - Recettes    : browse w/ "+ au batch" (#6 grocery cart)
 *   - Panier      : batch in progress + checkout (#6)
 *   - Frigo       : inventory (#1 mobile-first when shopping)
 *   - Tickets     : receipt upload + OCR
 *   - Gérer       : catalogue/variantes/imports/settings (#9 power tables)
 * #4 AI chef lives in the floating FAB (see ChefFab).
 *
 * Narrow-rail (72px) by default; expands to 220px on hover.
 */
export const NAV_ITEMS = [
  { href: "/planifier", label: "Planifier", icon: CalendarDays },
  { href: "/recipes", label: "Recettes", icon: BookOpen },
  { href: "/ingredients", label: "Ingrédients", icon: Sprout },
  { href: "/batch", label: "Panier", icon: ShoppingBasket },
  { href: "/frigo", label: "Frigo", icon: Snowflake },
  { href: "/receipts", label: "Tickets", icon: Receipt },
  { href: "/gerer", label: "Gérer", icon: Wrench },
] as const;

function isActiveRoute(href: string, pathname: string): boolean {
  if (href === "/planifier") {
    return pathname === "/" || pathname.startsWith("/planifier");
  }
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar() {
  const pathname = usePathname();
  const { count: cartCount } = useCart();

  return (
    <aside
      className={cn(
        "group/sidebar hidden md:flex",
        "w-[72px] hover:w-[220px] transition-[width] duration-200 ease-out",
        "shrink-0 flex-col bg-card border-r border-border h-full overflow-hidden",
      )}
    >
      {/* Logo block */}
      <div className="flex items-center gap-2 px-4 py-5 border-b border-border h-[72px]">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-primary-foreground">
          <ChefHat className="h-4 w-4" />
        </div>
        <div className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity whitespace-nowrap">
          <p className="title-serif font-bold text-lg leading-tight">BatchChef</p>
          <p className="text-[10px] text-muted-foreground leading-tight">v3.0</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActiveRoute(href, pathname);
          const showBadge = href === "/batch" && cartCount > 0;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex items-center gap-3 rounded-lg h-11 px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
              )}
            >
              <div className="relative shrink-0">
                <Icon className="h-5 w-5" />
                {showBadge && (
                  <span className={cn(
                    "absolute -top-1 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full",
                    "inline-flex items-center justify-center text-[10px] font-bold",
                    active ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground",
                  )}>
                    {cartCount}
                  </span>
                )}
              </div>
              <span className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity whitespace-nowrap">
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Footer — theme toggle */}
      <div className="p-2 border-t border-border flex items-center justify-center group-hover/sidebar:justify-start group-hover/sidebar:px-4">
        <ThemeToggle />
      </div>
    </aside>
  );
}
