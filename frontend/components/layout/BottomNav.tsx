"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, BookOpen, ShoppingBasket, Snowflake, Sprout } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCart } from "@/lib/cart";

/**
 * Mobile bottom-tab bar — 5 items focused on the daily/weekly flow.
 * Tickets + Gérer live in the Sidebar (desktop) only; on mobile they're
 * reachable via the "Gérer" card from the landing page or direct URL.
 */
const TABS = [
  { href: "/planifier", label: "Plan", icon: CalendarDays },
  { href: "/recipes", label: "Recettes", icon: BookOpen },
  { href: "/ingredients", label: "Ingrédients", icon: Sprout },
  { href: "/batch", label: "Panier", icon: ShoppingBasket },
  { href: "/frigo", label: "Frigo", icon: Snowflake },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const { count: cartCount } = useCart();

  const isActive = (href: string) => {
    if (href === "/planifier") return pathname === "/" || pathname.startsWith("/planifier");
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <nav className="md:hidden sticky bottom-0 z-30 bg-card/95 backdrop-blur border-t border-border pb-safe">
      <div className="grid grid-cols-5 h-16">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          const showBadge = href === "/batch" && cartCount > 0;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <div className="relative">
                <Icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />
                {showBadge && (
                  <span className="absolute -top-1 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-primary text-primary-foreground inline-flex items-center justify-center text-[10px] font-bold">
                    {cartCount}
                  </span>
                )}
              </div>
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
