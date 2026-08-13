import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import { SignOutButton } from "@/components/AuthButtons";
import { EnregistrerServiceWorker } from "@/components/EnregistrerServiceWorker";
import "./globals.css";

export const metadata: Metadata = {
  title: "BatchChef",
  description: "Planificateur de batch cooking — recettes, batchs, épicerie",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#c2410c",
  width: "device-width",
  initialScale: 1,
};

const NAV = [
  { href: "/", label: "Accueil" },
  { href: "/recettes", label: "Recettes" },
  { href: "/batchs", label: "Batchs" },
  { href: "/catalogue", label: "Catalogue" },
] as const;

// Lien retour vers le hub perso (overridable par env si l'URL change).
const HUB_URL = (process.env.NEXT_PUBLIC_HUB_URL || "https://hubperso.com").replace(/\/+$/, "");

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr-CA">
      <body className="min-h-dvh">
        <header className="sticky top-0 z-10 border-b border-stone-200 bg-stone-50/90 backdrop-blur dark:border-stone-800 dark:bg-stone-950/90">
          <nav className="mx-auto flex h-14 max-w-3xl items-center gap-1 px-3">
            <span className="mr-2 text-lg font-bold" style={{ color: "var(--accent)" }}>
              BatchChef
            </span>
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-stone-200 dark:hover:bg-stone-800"
              >
                {item.label}
              </Link>
            ))}
            <div className="ml-auto flex items-center gap-1">
              <a
                href={HUB_URL}
                className="rounded-lg px-3 py-2 text-sm font-medium text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800"
              >
                ← Hub
              </a>
              <SignOutButton />
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-3xl px-3 py-5">{children}</main>
        <EnregistrerServiceWorker />
        <Analytics />
      </body>
    </html>
  );
}
