// /portions — ce qu'il reste à manger.
//
// C'est l'écran qui rend l'app utile en semaine : jusqu'ici le cycle s'arrêtait à
// « terminé » (donc le dimanche) et rien ne disait ce qu'il y avait au congélo.

import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ListePortions } from "@/components/ListePortions";
import { estZone, type LignePortions } from "@/lib/portions";

export const dynamic = "force-dynamic";

export default async function PortionsPage() {
  const rangees = await db
    .select()
    .from(schema.portions)
    .orderBy(desc(schema.portions.rangeLe));

  // La colonne `zone` est un texte côté Postgres : on ne fait pas confiance à sa forme.
  // Une ligne hors contrat est ÉCARTÉE et DITE, jamais rangée d'office dans une zone —
  // afficher du congélo qui est au frigo serait pire que ne rien afficher.
  const lignes: LignePortions[] = [];
  let horsContrat = 0;
  for (const r of rangees) {
    if (!estZone(r.zone) || r.restantes <= 0) {
      horsContrat += 1;
      continue;
    }
    lignes.push({ id: r.id, titre: r.titre, zone: r.zone, restantes: r.restantes, rangeLe: r.rangeLe });
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Portions</h1>
        <p className="mt-1 text-sm doux">Ce qu’il reste à manger, le plus pressé en premier.</p>
      </div>

      {horsContrat > 0 && (
        <p className="rounded-lg alerte p-3 text-sm">
          {horsContrat} ligne{horsContrat > 1 ? "s" : ""} de stock illisible
          {horsContrat > 1 ? "s" : ""} (zone inconnue) — écartée
          {horsContrat > 1 ? "s" : ""} de l’affichage plutôt que rangée au hasard.
        </p>
      )}

      {lignes.length === 0 ? (
        <p
          className="rounded-2xl border border-dashed p-6 text-center text-sm doux"
          style={{ borderColor: "var(--bordure)" }}
        >
          Rien en stock. Les portions apparaissent ici quand tu termines un batch : l’app te
          demande alors ce que tu ranges, et où.
        </p>
      ) : (
        <ListePortions lignes={lignes} />
      )}
    </div>
  );
}
