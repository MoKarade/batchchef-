// / — accueil : l'état en un coup d'œil, les deux gestes principaux, et tes recettes récentes.
import Link from "next/link";
import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { RecipeCard } from "@/components/RecipeCard";
import { SemaineProposee } from "@/components/SemaineProposee";
import { prixSemaine, type PrixSemaine } from "@/lib/semaineDb";
import { semaineCourante } from "@/lib/semaineDb";
import { tempsSemaine, type TempsSemaine } from "@/lib/semaine";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [recipeCount] = await db.select({ n: count() }).from(schema.recipes);
  const [activeBatches] = await db
    .select({ n: count() })
    .from(schema.batches)
    .where(inArray(schema.batches.status, ["planifie", "courses", "cuisine"]));
  // ⚠️ La jointure sur `batches` n'est pas décorative : sans elle, le compteur additionnait
  // les articles non cochés de TOUS les batchs, terminés compris. Un batch fini dont il
  // restait des lignes jamais cochées gonflait ce chiffre pour toujours — un compteur qui se
  // dégrade avec le temps, donc qu'on finit par ne plus lire.
  const [toBuy] = await db
    .select({ n: count() })
    .from(schema.shoppingItems)
    .innerJoin(schema.batches, eq(schema.batches.id, schema.shoppingItems.batchId))
    .where(and(eq(schema.shoppingItems.checked, false), ne(schema.batches.status, "termine")));
  const recent = await db
    .select({
      id: schema.recipes.id,
      title: schema.recipes.title,
      imageUrl: schema.recipes.imageUrl,
      difficulte: schema.recipes.difficulteEstimee,
    })
    .from(schema.recipes)
    .orderBy(desc(schema.recipes.createdAt))
    .limit(6);

  // La semaine se FABRIQUE ici, à la première ouverture de la semaine (choix de Marc) —
  // pas par un cron.
  //
  // ⚠️ Une panne de ce côté ne doit pas emporter l'accueil : le reste de la page doit
  // continuer de servir. Mais elle ne doit pas non plus DISPARAÎTRE — « aucune proposition »
  // et « la proposition est cassée » s'afficheraient pareil, et c'est exactement le mode de
  // panne que ce dépôt chasse. On garde donc le repli ET on dit la cause, à l'écran comme
  // dans les journaux.
  let semaine: Awaited<ReturnType<typeof semaineCourante>> | null = null;
  let panneSemaine: string | null = null;
  try {
    semaine = await semaineCourante();
  } catch (err) {
    panneSemaine = err instanceof Error ? err.message : String(err);
    console.error("[semaine] proposition indisponible :", panneSemaine);
  }

  // Le temps se DÉDUIT des recettes déjà chargées : aucune requête de plus, aucune horloge.
  const temps: TempsSemaine | null = semaine ? tempsSemaine(semaine.recettes) : null;

  // ⚠️ Le prix est le SEUL des trois chiffres qui peut coûter un appel payant. Il est calculé
  // une fois par composition et mémorisé (cf. `prixSemaine`) — mais son échec ne doit pas
  // emporter la carte : la semaine reste affichable sans son prix, l'inverse serait absurde.
  let prix: PrixSemaine | null = null;
  if (semaine && semaine.recettes.length > 0) {
    try {
      prix = await prixSemaine(semaine.semaine, semaine.recettes);
    } catch (err) {
      console.error("[semaine] prix indisponible :", err instanceof Error ? err.message : err);
    }
  }

  const stats = [
    { label: "Recettes", value: recipeCount?.n ?? 0, href: "/recettes" },
    { label: "Batchs actifs", value: activeBatches?.n ?? 0, href: "/batchs" },
    { label: "Articles à acheter", value: toBuy?.n ?? 0, href: "/batchs" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-2xl border border-[var(--bordure)] bg-[var(--surface)] p-4 text-center shadow-sm"
          >
            <div className="text-2xl font-bold tabular-nums">{s.value}</div>
            <div className="mt-1 text-xs doux">{s.label}</div>
          </Link>
        ))}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/recettes"
          className="flex-1 rounded-xl border border-[var(--bordure)] px-4 py-3 text-center font-medium"
        >
          + Importer une recette
        </Link>
        <Link
          href="/batchs/nouveau"
          className="bouton bouton-principal flex-1"
        >
          Nouveau batch
        </Link>
      </div>

      <SemaineProposee
        recettes={semaine?.recettes ?? []}
        temps={temps}
        prix={prix ? { cents: prix.cents, methode: prix.methode } : null}
        panne={panneSemaine}
      />

      {recent.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recettes récentes</h2>
            <Link href="/recettes" className="text-sm underline">
              Tout voir
            </Link>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {recent.map((r) => (
              <li key={r.id}>
                <RecipeCard
                  href={`/recettes/${r.id}`}
                  title={r.title}
                  imageUrl={r.imageUrl}
                  difficulte={r.difficulte}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm doux">
          Le cycle : importe tes recettes → compose un batch → fais l’épicerie avec la liste
          sur ton téléphone.
        </p>
      )}
    </div>
  );
}
