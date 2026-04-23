"use client";

import Link from "next/link";
import { ChefHat } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Mobile-only top bar. Desktop uses the narrow sidebar instead.
 * Keeps the logo visible + ThemeToggle accessible.
 */
export function TopBar() {
  return (
    <header className="md:hidden sticky top-0 z-30 flex items-center justify-between h-14 px-4 bg-card/80 backdrop-blur border-b border-border">
      <Link href="/" className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary text-primary-foreground">
          <ChefHat className="h-4 w-4" />
        </div>
        <span className="title-serif font-bold text-lg">BatchChef</span>
      </Link>
      <ThemeToggle />
    </header>
  );
}
