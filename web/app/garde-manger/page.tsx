// /garde-manger — ce que Marc a déclaré avoir toujours.
//
// L'ajout se fait depuis la liste d'épicerie (bouton « Placard »), là où la pensée arrive.
// Cet écran sert à VOIR et à DÉFAIRE : sans lui, un article déclaré par erreur resterait
// écarté du budget pour toujours, sans aucun moyen de revenir en arrière.

import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { GestionGardeManger } from "@/components/GestionGardeManger";

export const dynamic = "force-dynamic";

export default async function GardeMangerPage() {
  const articles = await db.select().from(schema.pantry).orderBy(asc(schema.pantry.nom));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Garde-manger</h1>
        <p className="mt-1 text-sm doux">
          Ce que tu as toujours : écarté du budget d’épicerie, jamais retiré de la liste.
        </p>
      </div>

      {articles.length === 0 ? (
        <p
          className="rounded-2xl border border-dashed p-6 text-center text-sm doux"
          style={{ borderColor: "var(--bordure)" }}
        >
          Vide, et c’est voulu — l’app ne devine pas ce qu’il y a dans ton placard. Sur une
          liste d’épicerie, touche « Placard » à côté d’un article que tu as toujours (sel,
          huile, farine) et il apparaîtra ici.
        </p>
      ) : (
        <GestionGardeManger
          articles={articles.map((a) => ({ id: a.id, nom: a.nom }))}
        />
      )}

      <Link href="/batchs" className="bouton bouton-second w-full">
        Retour aux batchs
      </Link>
    </div>
  );
}
