"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "@/lib/auth";

/**
 * Root providers. Dark mode is managed by the existing lightweight
 * ``components/layout/ThemeToggle`` (localStorage + <html class="dark">) —
 * we don't need next-themes on top of it.
 *
 * The ``<Toaster>`` sits at the root so any component can call
 * ``import { toast } from "react-hot-toast"`` and the notification lands
 * in the top-right without plumbing a provider context.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3500,
            className:
              "!bg-card !text-foreground !border !border-border !shadow-lg !rounded-xl",
          }}
        />
      </AuthProvider>
    </QueryClientProvider>
  );
}
