import type { Metadata, Viewport } from "next";
import { SignOutButton } from "@/components/AuthButtons";
import { EnregistrerServiceWorker } from "@/components/EnregistrerServiceWorker";
import { NavigationBasse, NavigationHaute } from "@/components/Navigation";
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
  // La barre du bas s'ancre sur la zone sûre : encore faut-il que le navigateur la donne.
  viewportFit: "cover",
};

// Lien retour vers le hub perso (overridable par env si l'URL change).
const HUB_URL = (process.env.NEXT_PUBLIC_HUB_URL || "https://hubperso.com").replace(/\/+$/, "");

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr-CA">
      <body className="min-h-dvh">
        {/* L'en-tête ne porte plus que l'identité et les gestes RARES (hub, déconnexion).
            Les quatre onglets vivent en bas sur téléphone : c'est là que se trouve le
            pouce, et c'est ce qui a réglé le débordement de l'ancienne barre unique. */}
        <header
          className="sticky top-0 z-10 border-b backdrop-blur"
          style={{ borderColor: "var(--bordure)", backgroundColor: "color-mix(in srgb, var(--fond) 90%, transparent)" }}
        >
          <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
            <span
              className="text-lg font-bold tracking-tight"
              style={{ color: "var(--accent)", fontFamily: "var(--police-titre)" }}
            >
              BatchChef
            </span>
            <NavigationHaute />
            <div className="ml-auto flex items-center gap-1">
              <a
                href={HUB_URL}
                className="rounded-lg px-2 py-2 text-sm font-medium"
                style={{ color: "var(--texte-doux)" }}
              >
                ← Hub
              </a>
              <SignOutButton />
            </div>
          </div>
        </header>

        {/* La marge basse dégage la barre d'onglets : sans elle, le dernier élément de
            chaque page passe dessous et devient impossible à atteindre. */}
        <main className="mx-auto max-w-3xl px-4 py-5 pb-28 sm:pb-8">{children}</main>

        <NavigationBasse />
        <EnregistrerServiceWorker />
      </body>
    </html>
  );
}
