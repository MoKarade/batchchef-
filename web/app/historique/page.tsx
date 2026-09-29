// /historique — HIST-01 : ce que Marc a cuisiné, et à quelle fréquence.
//
// ⚠️ « Cuisiné », jamais « mangé » : la trace naît quand un batch passe à « Terminé ». L'app
// ne sait pas ce qui a été avalé, ni quand ; les portions sont celles PRÉVUES. L'historique
// démarre vide à la mise en ligne : aucune date n'est inventée pour le passé.
//
// Accès : sous le middleware (session requise), comme toutes les pages hors /login.
import Link from "next/link";
import { etatHistorique, type FrequenceRecette, type SemaineHistorique } from "@/lib/historique";
import { lireHistorique } from "@/lib/historiqueDb";
import { formatDateAjout } from "@/lib/origine";

export const dynamic = "force-dynamic";

function LienRecette({ recipeId, titre }: { recipeId: number | null; titre: string }) {
  if (recipeId === null) return <span className="font-bold">{titre}</span>;
  return (
    <Link href={`/recettes/${recipeId}`} className="font-bold underline-offset-4 hover:underline">
      {titre}
    </Link>
  );
}

function Frequences({ frequences, depuis }: { frequences: FrequenceRecette[]; depuis: string }) {
  return (
    <section aria-labelledby="frequence">
      <h2 id="frequence" className="mb-1 text-xl font-bold">
        Ce que tu cuisines le plus
      </h2>
      <p className="doux mb-3 text-sm">
        Depuis le {depuis} — seules les cuissons enregistrées depuis la mise en ligne comptent.
      </p>
      <ul className="liste">
        {frequences.map((f) => (
          <li key={f.cle} className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3">
            <span className="min-w-0 flex-1">
              <LienRecette recipeId={f.recipeId} titre={f.titre} />
              {f.recetteRetiree && <span className="doux block text-sm">recette retirée de ta bibliothèque</span>}
            </span>
            <span className="doux num shrink-0 text-sm">
              {f.fois} fois · dernière fois le {formatDateAjout(f.derniere)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Chronologique({ semaines }: { semaines: SemaineHistorique[] }) {
  return (
    <section aria-labelledby="chronologique">
      <h2 id="chronologique" className="mb-3 text-xl font-bold">
        Chronologique
      </h2>
      <div className="pile">
        {semaines.map((s) => (
          <div key={s.semaine}>
            <h3 className="surtitre mb-2">
              Semaine du {s.lundi} <span className="num">({s.semaine})</span>
            </h3>
            <ul className="pile">
              {s.cuissons.map((c) => (
                <li key={c.cle} className="carte carte-corps">
                  <p className="text-base font-bold">
                    <span className="doux font-normal">Cuisiné le {c.date} — </span>
                    {c.batchId !== null ? (
                      <Link href={`/batchs/${c.batchId}`} className="underline-offset-4 hover:underline">
                        {c.nomBatch}
                      </Link>
                    ) : (
                      c.nomBatch
                    )}
                  </p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {c.recettes.map((r, i) => (
                      <li key={`${c.cle}-${i}`}>
                        · <LienRecette recipeId={r.recipeId} titre={r.titre} />{" "}
                        <span className="doux num">— {r.portions} portions prévues</span>
                        {r.recetteRetiree && <span className="doux"> (recette retirée de ta bibliothèque)</span>}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function HistoriquePage() {
  const etat = etatHistorique(await lireHistorique());

  return (
    <div className="space-y-8">
      <header className="entete">
        <div>
          <p className="surtitre">Batchs</p>
          <h1>Historique de ce que tu as cuisiné</h1>
        </div>
        <Link href="/batchs" className="bouton bouton-second">
          Retour aux batchs
        </Link>
      </header>

      {etat.type === "vide" ? (
        <div className="vide">
          <h2>Aucune cuisson enregistrée</h2>
          <p>{etat.message}</p>
        </div>
      ) : (
        <>
          <Frequences frequences={etat.frequences} depuis={etat.depuis} />
          <Chronologique semaines={etat.semaines} />
        </>
      )}
    </div>
  );
}
