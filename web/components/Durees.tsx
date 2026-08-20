// Durée d'une recette (CAT-C). Rien ne s'affiche quand la source ne dit rien.
import { dureesAffichables } from "@/lib/tempsRecette";

/**
 * ⚠️ 224 recettes du catalogue portent 0 en préparation ET 0 en cuisson : c'est une donnée
 * MANQUANTE, pas une recette instantanée. `dureesAffichables` rend alors trois `null`, et ce
 * composant ne rend rien du tout — plutôt qu'un « 0 min » qui affirmerait le contraire.
 */
export function Durees({ prep, cuisson }: { prep: number | null; cuisson: number | null }) {
  const d = dureesAffichables(prep, cuisson);
  if (!d.total) return null;
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {d.preparation && (
        <div className="flex gap-2">
          <dt className="doux">Préparation</dt>
          <dd className="tabular-nums font-medium">{d.preparation}</dd>
        </div>
      )}
      {d.cuisson && (
        <div className="flex gap-2">
          <dt className="doux">Cuisson</dt>
          <dd className="tabular-nums font-medium">{d.cuisson}</dd>
        </div>
      )}
      <div className="flex gap-2">
        <dt className="doux">Total</dt>
        <dd className="tabular-nums font-medium">{d.total}</dd>
      </div>
    </dl>
  );
}
