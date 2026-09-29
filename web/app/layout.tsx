import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SignOutButton } from "@/components/AuthButtons";
import { EnregistrerServiceWorker } from "@/components/EnregistrerServiceWorker";
import { Navigation } from "@/components/Navigation";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
        <div className="coque">
          {/* Téléphone : une fine barre en haut pour l'identité et les gestes RARES (hub,
              déconnexion) ; les onglets vivent en bas, là où se trouve le pouce.
              Dès 768 px, la barre latérale les porte tous et cette barre disparaît. */}
          <header className="barre-haute md:hidden">
            <span className="text-base font-bold tracking-tight">BatchChef</span>
            <div className="ml-auto flex items-center gap-1">{pied}</div>
          </header>

          <Navigation pied={pied} />

          {/* La marge basse (`.principal`) dégage la barre d'onglets : sans elle, le dernier
              élément de chaque page passe dessous et devient impossible à atteindre. */}
          <main className="principal">{children}</main>
        </div>
        <EnregistrerServiceWorker />
        <Analytics />
      </body>
    </html>
  );
}
