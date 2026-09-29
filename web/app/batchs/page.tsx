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
 * Chaque statut se lit au TEXTE de sa pastille ; ce qui demande une ACTION (courses, cuisine)
 * y ajoute le contour argent de « statut ». Jamais `--repere` : ce n'est pas un état.
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
    <div>
      <header className="entete">
        <div>
          <p className="surtitre">Batchs</p>
          <h1>Batchs</h1>
        </div>
        <div className="ligne">
          {/* HIST-01 : un lien, pas un onglet de navigation de plus (décision de Marc). */}
          <Link href="/historique" className="bouton bouton-second">
            Historique
          </Link>
          {batches.length > 0 && (
            <Link href="/batchs/nouveau" className="bouton bouton-principal">
              + Nouveau
            </Link>
          )}
        </div>
      </header>

      {batches.length === 0 ? (
        <div className="vide">
          <h2>Aucun batch pour l’instant</h2>
          <p>Importe des recettes puis compose ton premier batch.</p>
          <Link href="/batchs/nouveau" className="bouton bouton-principal">
            Créer un batch
          </Link>
        </div>
      ) : (
        <ul className="pile">
          {batches.map((b) => {
            const statut = STATUTS[b.status] ?? { label: b.status, actif: false };
            return (
              <li key={b.id} className="carte flex items-center gap-3 p-4">
                <Link href={`/batchs/${b.id}`} className="min-w-0 flex-1">
                  <span className="block truncate text-base font-bold">{b.name}</span>
                  <span className={`pastille mt-1 ${statut.actif ? "statut" : ""}`}>
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
