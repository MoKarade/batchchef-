"use client";

// Coque de l'app : barre du haut (téléphone) + navigation + zone de la page.
// Sur /login, rien de tout ça : seulement la page, centrée par son propre style.

import { usePathname } from "next/navigation";
import { Navigation, estPageSansMenu } from "@/components/Navigation";

export function Coque({
  pied,
  children,
}: {
  pied: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (estPageSansMenu(pathname)) {
    return (
      <div className="coque">
        <main className="principal">{children}</main>
      </div>
    );
  }

  return (
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
  );
}
