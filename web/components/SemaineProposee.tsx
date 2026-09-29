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
      <section aria-labelledby="titre-semaine">
        <EnTete />
        <div className="bandeau erreur" role="alert">
          <IconeErreur />
          <div>
            <strong>La semaine n’a pas pu être préparée.</strong>
            <span>La proposition de la semaine n’a pas pu être préparée : {panne}</span>
          </div>
        </div>
      </section>
    );
  }
  if (recettes.length === 0) {
    return (
      <section aria-labelledby="titre-semaine">
        <EnTete />
        <div className="vide">
          <h2>Pas encore de semaine proposée</h2>
          <p>Aucune recette à proposer pour l’instant — le catalogue est vide.</p>
        </div>
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
    <section aria-labelledby="titre-semaine">
      <EnTete
        description="Trois plats et un dessert. Change-en un, ou crée le batch quand la semaine te convient."
        actions={
          <>
            <button
              type="button"
              disabled={pending || confirmeRegen}
              onClick={() => setConfirmeRegen(true)}
              className="bouton bouton-second"
            >
              Propose-moi une autre semaine
            </button>
            {batchCree === null ? (
              <button
                type="button"
                disabled={pending}
                onClick={monterLeBatch}
                className="bouton bouton-principal"
              >
                <IconePlus />
                {pending ? "…" : "Créer le batch de la semaine"}
              </button>
            ) : (
              <Link href={`/batchs/${batchCree}`} className="bouton bouton-principal">
                Batch créé — voir la liste d’épicerie
              </Link>
            )}
          </>
        }
      />

      {/* ⚠️ Deux temps pour la regénération (cf. plus haut) : la confirmation est un bandeau
          d'alerte avec ses deux boutons, pas un simple texte. */}
      {confirmeRegen && (
        <div className="bandeau alerte mb-4" role="alertdialog" aria-labelledby="titre-regen">
          <IconeAlerte />
          <div>
            <strong id="titre-regen">Régénérer remplace les quatre recettes.</strong>
            <span>
              Les quatre recettes seront remplacées, et celles d’aujourd’hui ne reviendront pas.
            </span>
            <div className="ligne mt-3">
              <button
                type="button"
                disabled={pending}
                onClick={regenerer}
                className="bouton bouton-second"
              >
                {pending ? "…" : "Oui, propose-m’en quatre autres"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirmeRegen(false)}
                className="bouton bouton-second"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      <Synthese temps={temps} prix={prix} />

      <ul className="grille g4 mt-4" aria-label="Recettes de la semaine">
        {recettes.map((r) => (
          <li key={r.position} className="carte flex flex-col overflow-hidden">
            <Link href={`/catalogue/${r.catalogRecipeId}`} className="block">
              {r.imageUrl ? (
                <ImageRecette src={r.imageUrl} className="photo" lazy />
              ) : (
                <div className="photo photo-vide" aria-hidden />
              )}
              <div className="carte-corps">
                <h3 className="line-clamp-2 text-base font-bold">{r.titre}</h3>
                <div className="meta">
                  {r.type && <span className="pastille repere">{LIBELLES[r.type]}</span>}
                  <Durees prep={r.prepMinutes} cuisson={r.cuissonMinutes} />
                </div>
                <div className="mt-2">
                  <Etoiles etoiles={r.difficulte} compact />
                </div>
              </div>
            </Link>
            <div className="mt-auto px-5 pb-4">
              <button
                type="button"
                disabled={pending}
                onClick={() => remplacer(r.position)}
                className="bouton bouton-second w-full"
              >
                {enCours === r.position ? "…" : "Remplacer"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {recettes.length < 4 && (
        <p className="doux mt-4">
          {4 - recettes.length} place(s) non pourvue(s) : le catalogue n’a pas de quoi compléter
          la semaine sous cette composition. Mieux vaut une place vide qu’une recette qui ment
          sur ce qu’elle est.
        </p>
      )}

      {erreur && (
        <div className="bandeau erreur mt-4" role="alert">
          <IconeErreur />
          <div>{erreur}</div>
        </div>
      )}
    </section>
  );
}

/** En-tête commun à tous les états de la carte : surtitre, titre, actions éventuelles. */
function EnTete({
  description,
  actions,
}: {
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="entete">
      <div>
        <p className="surtitre">Accueil</p>
        <h1 id="titre-semaine">Ta semaine</h1>
        {description && <p className="doux mt-1">{description}</p>}
      </div>
      {actions && <div className="ligne">{actions}</div>}
    </header>
  );
}

function IconePlus() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconeErreur() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 16.5v.5" />
    </svg>
  );
}

function IconeAlerte() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.5" />
    </svg>
  );
}

/**
 * La synthèse : temps total et prix estimé de la semaine (SEM-05), en trois tuiles.
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
    <div className="space-y-3">
      <div role="group" aria-label="Résumé de la semaine" className="tuiles">
        <div className="tuile">
          <div className="tuile-lib">Temps total</div>
          <div className="tuile-val">{duree ?? "Inconnu"}</div>
          <div className="doux text-sm">
            {duree ? "de cuisine" : "Durée inconnue pour toutes les recettes"}
          </div>
        </div>
        <div className="tuile">
          <div className="tuile-lib">Prix estimé</div>
          <div className="tuile-val">{montant ? `≈ ${montant}` : "Non estimé"}</div>
          <div className="text-sm">
            {montant ? (
              <span className="pastille alerte">Estimation</span>
            ) : (
              <span className="doux">prix non calculé</span>
            )}
          </div>
        </div>
        <div className="tuile">
          <div className="tuile-lib">Sans durée connue</div>
          <div className="tuile-val">{temps.sansDuree.length}</div>
          <div className="doux text-sm">recettes dont la source ne dit rien</div>
        </div>
      </div>

      {/* ⚠️ Les deux mentions ci-dessous ne sont pas de la prudence décorative : sans elles,
          un total amputé et un tarif forfaitaire se lisent comme des mesures exactes. */}
      {temps.sansDuree.length > 0 && (
        <p className="text-sm doux">
          {duree ? "Temps calculé sur " : ""}
          {duree ? `${temps.comptees} recette${temps.comptees > 1 ? "s" : ""} sur ${temps.comptees + temps.sansDuree.length} — ` : ""}
          la source ne donne aucune durée pour&nbsp;: {temps.sansDuree.join(", ")}.
        </p>
      )}
      {prix != null && (
        <p className="text-sm doux">
          {prix.methode === "llm"
            ? "Prix estimé ingrédient par ingrédient, comme celui du batch. Une estimation, jamais un prix relevé."
            : "Estimation indisponible : ce montant vient d’un tarif forfaitaire, donc plus grossier que celui du batch."}
        </p>
      )}
    </div>
  );
}
