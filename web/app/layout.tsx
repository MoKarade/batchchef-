import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SignOutButton } from "@/components/AuthButtons";
import { EnregistrerServiceWorker } from "@/components/EnregistrerServiceWorker";
import { Coque } from "@/components/Coque";
import NavApps from "@/components/NavApps";
import { APP_COURANTE, navAppsAutorisee } from "@/lib/navAppsMonter";
import "./globals.css";

export const metadata: Metadata = {
  title: "BatchChef",
  description: "Planificateur de batch cooking — recettes, batchs, épicerie",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  // Fond du thème sombre (`--fond`) : la barre du navigateur se fond dans la page.
  themeColor: "#07090d",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // La barre du bas s'ancre sur la zone sûre : encore faut-il que le navigateur la donne.
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // L'onglet « Apps » (le hub y est) remplace l'ancien lien « ← Hub » ; propriétaire seul, échec fermé.
  const navApps = await navAppsAutorisee();
  const pied = (
    <>
      {navApps ? <NavApps courant={APP_COURANTE} /> : null}
      <SignOutButton />
    </>
  );

  return (
    <html lang="fr-CA">
      <body className="min-h-dvh">
        <Coque pied={pied}>{children}</Coque>
        <EnregistrerServiceWorker />
        <Analytics />
      </body>
    </html>
  );
}
