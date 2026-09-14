"use client";

// La carte « Ta semaine » (SEM-02) : quatre recettes du catalogue, remplaçables une à une,
// et un bouton qui monte le batch avec sa liste d'épicerie.
//
// ⚠️ Ce qui est AFFICHÉ ici est mesuré ou rien : les durées viennent du catalogue et
// `Durees` ne rend rien quand la source ne dit pas. Aucun « facile », aucun « végétarien » —
// le classement n'existe pas encore (SEM-01), et l'inventer serait exactement le contraire
// de ce que l'app promet.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Durees } from "@/components/Durees";
import { Etoiles } from "@/components/Etoiles";
import { ImageRecette } from "@/components/ImageRecette";
import { creerBatchDepuisSemaine, regenererSemaineAction, remplacerRecetteSemaine } from "@/lib/actions";
import { formatMinutes, type TempsSemaine } from "@/lib/semaine";
import { LIBELLES, type TypePlat } from "@/lib/typePlat";

export interface RecetteProposee {
  catalogRecipeId: number;
  titre: string;
  imageUrl: string | null;
  prepMinutes: number | null;
  cuissonMinutes: number | null;
  position: number;
  type: TypePlat | null;
  /** Difficulté estimée, 1 à 5 (SEM-05). `null` = trop peu de signaux. */
  difficulte: number | null;
}

export interface PrixAffiche {
  cents: number;
  /** "llm" = estimé ingrédient par ingrédient. "filet" = tarif forfaitaire, et on le DIT. */
  methode: "llm" | "filet";
}

export function SemaineProposee({
  recettes,
  temps,
  prix,
  panne,
}: {
  recettes: RecetteProposee[];
  /** Le temps total, et les recettes dont la source ne dit rien. `null` = pas de semaine. */
  temps?: TempsSemaine | null;
  /** Le prix estimé, ou `null` s'il n'a pas pu être calculé — l'écran le dit alors. */
  prix?: PrixAffiche | null;
  /** Message de la panne qui a empêché de fabriquer la semaine, s'il y en a eu une. */
  panne?: string | null;
}) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [batchCree, setBatchCree] = useState<number | null>(null);
  const [enCours, setEnCours] = useState<number | null>(null);
  // ⚠️ Deux temps pour la regénération : le premier clic DEMANDE, le second CONFIRME.
  // Elle efface quatre choix que Marc a pu faire un par un, et l'ancienne proposition n'est
  // pas conservée (une seule semaine vivante, SEM-02) — un geste qu'on ne peut pas défaire
  // mérite un second geste.
  const [confirmeRegen, setConfirmeRegen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // ⚠️ Trois situations DISTINCTES, trois affichages : une panne se nomme, un catalogue
  // vide se dit, et quatre recettes s'affichent. Les confondre rendrait la panne invisible.
  if (panne) {
    return (
      <section className="carte space-y-2 p-4">
        <h2 className="text-lg font-semibold">Ta semaine</h2>
        <p className="text-sm texte-erreur">
          La proposition de la semaine n’a pas pu être préparée : {panne}
        </p>
      </section>
    );
  }
  if (recettes.length === 0) {
    return (
      <section className="carte space-y-2 p-4">
        <h2 className="text-lg font-semibold">Ta semaine</h2>
        <p className="text-sm doux">
          Aucune recette à proposer pour l’instant — le catalogue est vide.
        </p>
      </section>
    );
  }

  const remplacer = (position: number) =>
    startTransition(async () => {
      setErreur(null);
      setEnCours(position);
      const res = await remplacerRecetteSemaine(position);
      setEnCours(null);
      if (!res.ok) setErreur(res.error);
      else router.refresh();
    });

  const regenerer = () =>
    startTransition(async () => {
      setErreur(null);
      const res = await regenererSemaineAction();
      setConfirmeRegen(false);
      if (!res.ok) setErreur(res.error);
      else router.refresh();
    });

  const monterLeBatch = () =>
    startTransition(async () => {
      setErreur(null);
      const res = await creerBatchDepuisSemaine();
      if (!res.ok) setErreur(res.error);
      else setBatchCree(res.id ?? null);
    });

  return (
    <section className="carte space-y-3 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Ta semaine</h2>
        <span className="text-xs doux">Trois plats et un dessert</span>
      </div>

      <Synthese temps={temps} prix={prix} />

      <ul className="grid gap-3 sm:grid-cols-2">
        {recettes.map((r) => (
          <li
            key={r.position}
            className="flex gap-3 rounded-xl border border-[var(--bordure)] p-2"
          >
            {r.imageUrl ? (
              <ImageRecette
                src={r.imageUrl}
                className="h-20 w-20 shrink-0 rounded-lg object-cover"
                lazy
              />
            ) : (
              <div
                className="h-20 w-20 shrink-0 rounded-lg"
                style={{ backgroundColor: "var(--surface-douce)" }}
                aria-hidden
              />
            )}
            <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
              <div className="min-w-0">
                <Link
                  href={`/catalogue/${r.catalogRecipeId}`}
                  className="line-clamp-2 text-sm font-medium underline-offset-2 hover:underline"
                >
                  {r.titre}
                </Link>
                {r.type && <div className="mt-1 text-xs doux">{LIBELLES[r.type]}</div>}
                <div className="mt-1 text-xs">
                  <Durees prep={r.prepMinutes} cuisson={r.cuissonMinutes} />
                </div>
                <div className="mt-1">
                  <Etoiles etoiles={r.difficulte} compact />
                </div>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => remplacer(r.position)}
                className="self-start rounded-lg border border-[var(--bordure)] px-3 py-2 text-xs disabled:opacity-50"
              >
                {enCours === r.position ? "…" : "Remplacer"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {confirmeRegen ? (
        <div className="space-y-2 rounded-xl p-2 alerte">
          <p className="text-xs">
            Les quatre recettes seront remplacées, et celles d’aujourd’hui ne reviendront pas.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={regenerer}
              className="flex-1 rounded-lg border border-[var(--bordure)] px-3 py-2 text-xs disabled:opacity-50"
            >
              {pending ? "…" : "Oui, propose-m’en quatre autres"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmeRegen(false)}
              className="flex-1 rounded-lg border border-[var(--bordure)] px-3 py-2 text-xs disabled:opacity-50"
            >
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirmeRegen(true)}
          className="w-full rounded-lg border border-[var(--bordure)] px-3 py-2 text-xs disabled:opacity-50"
        >
          Propose-moi une autre semaine
        </button>
      )}

      {batchCree === null ? (
        <button
          type="button"
          disabled={pending}
          onClick={monterLeBatch}
          className="bouton bouton-principal w-full disabled:opacity-50"
        >
          {pending ? "…" : "Créer le batch de la semaine"}
        </button>
      ) : (
        <Link href={`/batchs/${batchCree}`} className="bouton bouton-principal block w-full text-center">
          Batch créé — voir la liste d’épicerie
        </Link>
      )}

      {recettes.length < 4 && (
        <p className="text-sm doux">
          {4 - recettes.length} place(s) non pourvue(s) : le catalogue n’a pas de quoi compléter
          la semaine sous cette composition. Mieux vaut une place vide qu’une recette qui ment
          sur ce qu’elle est.
        </p>
      )}

      {erreur && <p className="text-sm texte-erreur">{erreur}</p>}
    </section>
  );
}

/**
 * La ligne de synthèse : temps total et prix estimé de la semaine (SEM-05).
 *
 * ⚠️ Chacun des deux peut MANQUER, et pour des raisons différentes — une recette sans durée
 * dans la source, un prix qui n'a pas pu être calculé. Les deux se DISENT, aucun ne se
 * remplace par un zéro : un total plus court que la réalité et un prix à 0 $ ont l'air de
 * mesures, et c'est exactement ce que le reste de l'app s'interdit.
 */
function Synthese({ temps, prix }: { temps?: TempsSemaine | null; prix?: PrixAffiche | null }) {
  if (!temps) return null;
  const duree = formatMinutes(temps.minutes);
  const montant =
    prix == null
      ? null
      : (prix.cents / 100).toLocaleString("fr-CA", { style: "currency", currency: "CAD" });

  return (
    <div className="space-y-1 text-sm">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {duree ? (
          <span>
            <strong className="tabular-nums">{duree}</strong> de cuisine
          </span>
        ) : (
          <span className="doux">Durée inconnue pour toutes les recettes</span>
        )}
        <span className="doux" aria-hidden>
          ·
        </span>
        {montant ? (
          <span>
            environ <strong className="tabular-nums">{montant}</strong> d’épicerie
          </span>
        ) : (
          <span className="doux">prix non calculé</span>
        )}
      </p>

      {/* ⚠️ Les deux mentions ci-dessous ne sont pas de la prudence décorative : sans elles,
          un total amputé et un tarif forfaitaire se lisent comme des mesures exactes. */}
      {temps.sansDuree.length > 0 && (
        <p className="text-xs doux">
          {duree ? "Temps calculé sur " : ""}
          {duree ? `${temps.comptees} recette${temps.comptees > 1 ? "s" : ""} sur ${temps.comptees + temps.sansDuree.length} — ` : ""}
          la source ne donne aucune durée pour&nbsp;: {temps.sansDuree.join(", ")}.
        </p>
      )}
      {prix != null && (
        <p className="text-xs doux">
          {prix.methode === "llm"
            ? "Prix estimé ingrédient par ingrédient, comme celui du batch. Une estimation, jamais un prix relevé."
            : "Estimation indisponible : ce montant vient d’un tarif forfaitaire, donc plus grossier que celui du batch."}
        </p>
      )}
    </div>
  );
}
