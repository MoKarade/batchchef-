// components/NavApps.tsx — l'onglet « Apps » : replié par défaut, il se déplie en un bouton par AUTRE app du parc.
// Composant serveur, zéro JavaScript : un <details> natif (clavier et lecteur d'écran gratuits). Les liens ouvrent
// l'app dans le même onglet. Aucune donnée dynamique, aucun état « en ligne » : la liste vient de `lib/appsDuParc.ts`.
// Monté par `app/layout.tsx` seulement si `navAppsAutorisee()`. Détail et copie dans une app : `docs/claude/14-nav-apps.md`.

import { autresApps, type AppId } from "@/lib/appsDuParc";

export default function NavApps({ courant }: { courant: AppId }) {
  return (
    <details className="nav-apps">
      <summary className="nav-apps-onglet" aria-label="Aller à une autre app">
        Apps
      </summary>
      <nav className="nav-apps-panneau" aria-label="Autres apps">
        {autresApps(courant).map((app) => (
          <a key={app.id} className="nav-apps-lien" href={app.adresse}>
            {app.nom}
          </a>
        ))}
      </nav>
    </details>
  );
}
