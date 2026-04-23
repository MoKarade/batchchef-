"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { ChefFab } from "./ChefFab";

const AUTH_PATHS = ["/login", "/register"];

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = AUTH_PATHS.includes(pathname);

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col md:flex-row h-[100dvh] overflow-hidden bg-background">
      {/* Desktop : narrow sidebar left */}
      <Sidebar />

      {/* Main column — on mobile stacks top→main→bottom, on desktop just main */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-muted/20">
          {children}
        </main>
        <BottomNav />
      </div>

      {/* Floating AI chef — always visible on authed pages */}
      <ChefFab />
    </div>
  );
}
