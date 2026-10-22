import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SignOutButton } from "@/components/AuthButtons";
import { EnregistrerServiceWorker } from "@/components/EnregistrerServiceWorker";
import { Coque } from "@/components/Coque";
import LiaMontee from "@/components/LiaMontee";
import { liaAutorisee } from "@/lib/lia/monter";
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

// Lien retour vers le hub perso (overridable par env si l'URL change).
const HUB_URL = (process.env.NEXT_PUBLIC_HUB_URL || "https://hubperso.com").replace(/\/+$/, "");

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lia = await liaAutorisee();
  const pied = (
    <>
      <a href={HUB_URL} className="nav-outil">
        ← Hub
      </a>
      <SignOutButton />
    </>
  );

  return (
    <html lang="fr-CA">
      <body className="min-h-dvh">
        <Coque pied={pied}>{children}</Coque>
        {lia ? <LiaMontee /> : null}
        <EnregistrerServiceWorker />
        <Analytics />
      </body>
    </html>
  );
}
