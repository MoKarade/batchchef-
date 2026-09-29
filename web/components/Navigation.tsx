"use client";

// Navigation principale — l'onglet ACTIF est marqué (couleur repère + trait + gras : jamais
// la couleur seule). Un seul composant, trois dispositions (refonte du 28/09/2026) :
// barre du bas sur téléphone (< 768 px), rail d'icônes (768-1023), barre latérale (>= 1024).
//
// Pourquoi en bas sur téléphone. L'ancienne barre entassait sur une seule ligne le nom de
// l'app, les onglets, « ← Hub » et la déconnexion : à 360 px ça débordait — sur l'appareil
// précisément utilisé pour la liste d'épicerie, debout, une main occupée par un panier. Le haut
// de l'écran est aussi le point le plus difficile à atteindre au pouce.
//
// Les gestes rares (hub, déconnexion) arrivent en `pied` : des Server Actions, donc rendus par
// le layout serveur et passés ici comme enfants.

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface Onglet {
  href: string;
  label: string;
}

export const ONGLETS: readonly Onglet[] = [
  { href: "/", label: "Accueil" },
  { href: "/recettes", label: "Recettes" },
  { href: "/batchs", label: "Batchs" },
  { href: "/assistant", label: "Assistant" },
  { href: "/catalogue", label: "Catalogue" },
] as const;

/**
 * Un onglet est actif sur SA section, pas seulement sur son URL exacte.
 *
 * Sans ça, `/recettes/12` n'allumerait aucun onglet et l'app paraîtrait « nulle part ».
 * L'accueil est le cas particulier : « / » est le préfixe de tout, donc égalité stricte.
 */
export function estOngletActif(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Tracés de la maquette (24×24, trait). Le style vit dans `.nav-lien svg` (globals.css). */
function Icone({ href }: { href: string }) {
  const trace = (() => {
    switch (href) {
      case "/":
        return (
          <>
            <path d="M3 11l9-8 9 8" />
            <path d="M5 10v10h14V10" />
          </>
        );
      case "/recettes":
        return (
          <>
            <path d="M4 4h11a3 3 0 013 3v13H7a3 3 0 01-3-3z" />
            <path d="M8 8h6" />
          </>
        );
      case "/batchs":
        return (
          <>
            <path d="M3 8l9-5 9 5v8l-9 5-9-5z" />
            <path d="M3 8l9 5 9-5M12 13v8" />
          </>
        );
      case "/assistant":
        return <path d="M4 5h16v11H9l-5 4z" />;
      default: // catalogue : boussole
        return (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M15.5 8.5l-2 5-5 2 2-5z" />
          </>
        );
    }
  })();
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {trace}
    </svg>
  );
}

export function Navigation({ pied }: { pied?: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigation principale" className="nav">
      <div className="nav-marque">BatchChef</div>
      {ONGLETS.map((onglet) => {
        const actif = estOngletActif(onglet.href, pathname);
        return (
          <Link
            key={onglet.href}
            href={onglet.href}
            aria-current={actif ? "page" : undefined}
            className="nav-lien"
          >
            <Icone href={onglet.href} />
            {onglet.label}
          </Link>
        );
      })}
      {pied ? <div className="nav-pied">{pied}</div> : null}
    </nav>
  );
}
