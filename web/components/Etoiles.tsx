// La difficulté ESTIMÉE, en étoiles (SEM-05).
//
// ⚠️ Un seul endroit rend cette note, parce qu'un seul endroit doit porter la mention
// « estimée ». Recopier les étoiles dans un écran finirait par produire une version sans
// l'avertissement — et une estimation présentée comme une donnée est exactement ce que le
// reste de l'app s'interdit.
//
// ⚠️ L'échelle est RELATIVE au catalogue : les coupes sont les quintiles mesurés. « 1 étoile »
// veut dire « parmi les plus simples du catalogue », pas « facile dans l'absolu ». Et ce qui
// est mesuré est l'EFFORT (ingrédients, étapes, durée), jamais la technique.

import { ETOILES_MAX, LIBELLES_DIFFICULTE, estDifficulte } from "@/lib/difficulte";

export function Etoiles({
  etoiles,
  compact = false,
}: {
  etoiles: number | null | undefined;
  /** Sur une carte : les étoiles seules, sans le libellé. L'infobulle le porte toujours. */
  compact?: boolean;
}) {
  if (!estDifficulte(etoiles)) {
    return (
      <span className="text-xs doux" title="Trop peu d'information dans la source pour estimer.">
        Difficulté non estimée
      </span>
    );
  }
  const libelle = LIBELLES_DIFFICULTE[etoiles];
  const infobulle = `Difficulté estimée : ${libelle} (${etoiles}/${ETOILES_MAX}). Déduite du nombre d’ingrédients, du nombre d’étapes et de la durée — relative au catalogue.`;

  return (
    <span className="inline-flex items-center gap-1" title={infobulle}>
      <span
        role="img"
        aria-label={`Difficulté estimée : ${etoiles} étoile${etoiles > 1 ? "s" : ""} sur ${ETOILES_MAX}, ${libelle}`}
        className="inline-flex"
      >
        {Array.from({ length: ETOILES_MAX }, (_, i) => (
          <Etoile key={i} pleine={i < etoiles} />
        ))}
      </span>
      {!compact && <span className="text-xs doux">{libelle} — estimée</span>}
    </span>
  );
}

/**
 * ⚠️ Un tracé SVG, pas un caractère : la convention du dépôt interdit les emoji dans l'UI,
 * et « ★ » rendu par une police système change de taille et d'alignement d'un appareil à
 * l'autre. `currentColor` pour la pleine, la bordure du thème pour la vide — jamais
 * `--accent`, qui ne sert qu'à l'action principale et laisserait croire que c'est cliquable.
 */
function Etoile({ pleine }: { pleine: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      className="h-3.5 w-3.5"
      style={{ color: pleine ? "var(--texte)" : "var(--bordure)" }}
    >
      <path
        fill="currentColor"
        d="M10 1.6l2.47 5.1 5.53.77-4.02 3.86.98 5.57L10 14.28l-4.96 2.62.98-5.57L2 7.47l5.53-.77L10 1.6z"
      />
    </svg>
  );
}
