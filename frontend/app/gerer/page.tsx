import Link from "next/link";
import { Upload, Settings2 } from "lucide-react";

const CARDS = [
  {
    href: "/gerer/imports",
    label: "Imports Marmiton",
    desc: "Lancer un import en masse. Scrape, standardise, classe et scrape les prix.",
    icon: Upload,
  },
  {
    href: "/gerer/settings",
    label: "Paramètres",
    desc: "Variables d'environnement + outils avancés (remap prix, couverture).",
    icon: Settings2,
  },
];

export default function Page() {
  return (
    <div className="space-y-4 max-w-3xl">
      <p className="text-sm text-muted-foreground">
        Outils d&apos;administration et de maintenance. La plupart de ce qui se trouve ici
        tourne automatiquement après un import — tu n&apos;as normalement pas besoin d&apos;y
        toucher, sauf pour rattraper ou forcer un remap.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {CARDS.map(({ href, label, desc, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="rounded-xl border bg-card p-5 hover:border-primary/60 hover:shadow-md transition-all"
          >
            <Icon className="h-5 w-5 text-primary mb-2" />
            <h3 className="font-semibold text-sm">{label}</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
