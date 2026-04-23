"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChefHat, BookOpen, ShoppingCart, Package, Receipt,
  Upload, Settings, Home, Sprout,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/recipes", label: "Recettes", icon: BookOpen },
  { href: "/ingredients", label: "Ingrédients", icon: Sprout },
  { href: "/batches", label: "Batch Cooking", icon: ChefHat },
  { href: "/shopping", label: "Liste de courses", icon: ShoppingCart },
  { href: "/inventory", label: "Inventaire", icon: Package },
  { href: "/receipts", label: "Tickets de caisse", icon: Receipt },
  { href: "/imports", label: "Import Marmiton", icon: Upload },
  { href: "/settings", label: "Paramètres", icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 flex flex-col bg-card border-r border-border h-full">
      {/* Logo */}
      <div className="flex items-center justify-between px-4 py-5 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary text-primary-foreground">
            <ChefHat className="h-4 w-4" />
          </div>
          <div>
            <p className="font-bold text-base leading-tight tracking-tight">BatchChef</p>
            <p className="text-[10px] text-muted-foreground leading-tight">v3.0 · Pricing</p>
          </div>
        </div>
        <ThemeToggle />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Auth widget disabled (local/single-user mode) */}
    </aside>
  );
}
