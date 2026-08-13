"use client";

// Navigation principale — l'onglet ACTIF est marqué, et la barre vit EN BAS sur téléphone.
//
// Pourquoi en bas. L'ancienne barre entassait sur une seule ligne, sans retour possible :
// le nom de l'app, quatre onglets, « ← Hub » et la déconnexion. À 360 px de large ça
// débordait — sur l'appareil précisément utilisé pour la liste d'épicerie, debout, une main
// occupée par un panier. Le haut de l'écran est aussi le point le plus difficile à atteindre
// au pouce sur un grand téléphone.
//
// Au-delà de `sm`, la souris rend le bas sans intérêt : les onglets remontent dans l'en-tête.

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

function Icone({ href, actif }: { href: string; actif: boolean }) {
  const trait = actif ? "var(--accent)" : "currentColor";
  const commun = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: trait,
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (href) {
    case "/": // toit
      return (
        <svg {...commun}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
        </svg>
      );
    case "/recettes": // casserole
      return (
        <svg {...commun}>
          <path d="M4 10h16v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-5Z" />
          <path d="M20 11h2M2 11h2" />
          <path d="M9 6.5c0-1 1.5-1 1.5-2M13.5 6.5c0-1 1.5-1 1.5-2" />
        </svg>
      );
    case "/batchs": // boîtes empilées
      return (
        <svg {...commun}>
          <rect x="3" y="13" width="18" height="7" rx="1.5" />
          <rect x="5.5" y="6" width="13" height="6" rx="1.5" />
        </svg>
      );
    default: // loupe (catalogue)
      return (
        <svg {...commun}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
      );
  }
}

/** Barre du bas, téléphone uniquement. */
export function NavigationBasse() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Navigation principale"
      // `env(safe-area-inset-bottom)` : sans ça, la barre passe SOUS la barre de gestes
      // d'Android et d'iOS, et le dernier onglet devient intouchable.
      className="fixed inset-x-0 bottom-0 z-20 border-t sm:hidden"
      style={{
        borderColor: "var(--bordure)",
        backgroundColor: "var(--surface)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <ul className="mx-auto flex max-w-3xl">
        {ONGLETS.map((onglet) => {
          const actif = estOngletActif(onglet.href, pathname);
          return (
            <li key={onglet.href} className="flex-1">
              <Link
                href={onglet.href}
                aria-current={actif ? "page" : undefined}
                className="flex min-h-[3.5rem] flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium"
                style={{ color: actif ? "var(--accent)" : "var(--texte-doux)" }}
              >
                <Icone href={onglet.href} actif={actif} />
                {onglet.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Onglets de l'en-tête, à partir de `sm` (souris : le bas n'a plus d'intérêt). */
export function NavigationHaute() {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigation principale" className="hidden sm:block">
      <ul className="flex items-center gap-1">
        {ONGLETS.map((onglet) => {
          const actif = estOngletActif(onglet.href, pathname);
          return (
            <li key={onglet.href}>
              <Link
                href={onglet.href}
                aria-current={actif ? "page" : undefined}
                className="block rounded-lg px-3 py-2 text-sm font-medium"
                style={{
                  color: actif ? "var(--accent)" : "var(--texte-doux)",
                  backgroundColor: actif ? "var(--accent-doux)" : undefined,
                }}
              >
                {onglet.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
