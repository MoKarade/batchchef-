// /batchs — liste des batchs, statut, accès à la liste de courses.
//
// Le statut est l'information la plus utile de cet écran : c'est lui qui dit s'il faut
// aller à l'épicerie, cuisiner, ou ne rien faire. Il portait la même pastille grise pour
// les quatre états — donc il ne disait rien d'un coup d'œil.
import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Chaque statut a sa teinte, tirée des variables : l'accent pour ce qui demande une
 * ACTION (courses, cuisine), du neutre pour ce qui attend ou ce qui est fini.
 */
const STATUTS: Record<string, { label: string; actif: boolean }> = {
  planifie: { label: "Planifié", actif: false },
  courses: { label: "Courses", actif: true },
  cuisine: { label: "Cuisine", actif: true },
  termine: { label: "Terminé", actif: false },
};

export default async function BatchesPage() {
  const batches = await db.select().from(schema.batches).orderBy(desc(schema.batches.createdAt));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Batchs</h1>
        <Link href="/batchs/nouveau" className="bouton bouton-principal">
          + Nouveau
        </Link>
      </div>

      {batches.length === 0 ? (
        <p
          className="rounded-2xl border border-dashed p-6 text-center text-sm doux"
          style={{ borderColor: "var(--bordure)" }}
        >
          Aucun batch. Importe des recettes puis compose ton premier batch.
        </p>
      ) : (
        <ul className="space-y-3">
          {batches.map((b) => {
            const statut = STATUTS[b.status] ?? { label: b.status, actif: false };
            return (
              <li key={b.id} className="carte flex items-center gap-3 p-4">
                <Link href={`/batchs/${b.id}`} className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{b.name}</span>
                  <span
                    className="mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                    style={
                      statut.actif
                        ? { backgroundColor: "var(--accent-doux)", color: "var(--accent-fonce)" }
                        : { backgroundColor: "var(--surface-douce)", color: "var(--texte-doux)" }
                    }
                  >
                    {statut.label}
                  </span>
                </Link>
                <Link href={`/courses/${b.id}`} className="bouton bouton-second shrink-0">
                  Liste
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
