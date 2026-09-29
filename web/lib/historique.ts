// lib/historique.ts — HIST-01 : la moitié PURE de l'historique de ce qui a été cuisiné.
//
// Une ligne = une recette d'un batch passé à « Terminé » (cf. `mealHistory` dans le schéma).
// ⚠️ « Terminé » veut dire CUISINÉ, pas mangé : l'app ne sait pas ce qui a été avalé ni quand.
// L'écran dit donc « cuisiné le » et « portions prévues », jamais « mangé ».
//
// Tout ici est pur et testé (tests/historique.test.ts) ; la lecture en base vit dans
// `historiqueDb.ts`.

import { FUSEAU, formatDateAjout } from "@/lib/origine";
import { semaineISO } from "@/lib/semaine";

export interface LigneHistorique {
  id: number;
  /** `null` une fois le batch supprimé : la trace reste, sans lien. */
  batchId: number | null;
  /** `null` une fois la recette retirée de la bibliothèque. */
  recipeId: number | null;
  titre: string;
  sourceUrl: string | null;
  nomBatch: string;
  /** Portions PRÉVUES dans le batch, pas mangées. */
  portions: number;
  cuisineLe: Date;
}

export const MESSAGE_HISTORIQUE_VIDE =
  "Rien d'enregistré pour l'instant. L'historique commence à la première fois que tu termines un batch après la mise en ligne de cet écran.";

/**
 * Clé de regroupement d'une recette (C6) : la SOURCE d'abord — la même recette ajoutée deux
 * fois depuis le catalogue a deux fiches mais une seule URL —, puis la fiche, puis le titre.
 */
export function cleRecette(l: LigneHistorique): string {
  if (l.sourceUrl) return `source:${l.sourceUrl}`;
  if (l.recipeId !== null) return `recette:${l.recipeId}`;
  return `titre:${l.titre.trim().toLowerCase()}`;
}

export interface FrequenceRecette {
  cle: string;
  /** Titre de la cuisson la plus récente (un titre peut changer après coup). */
  titre: string;
  fois: number;
  derniere: Date;
  /** Fiche de la cuisson la plus récente, pour le lien ; `null` si retirée. */
  recipeId: number | null;
  recetteRetiree: boolean;
}

/** Fréquence par recette, triée par nombre de fois décroissant puis par date la plus récente. */
export function regrouperParRecette(lignes: readonly LigneHistorique[]): FrequenceRecette[] {
  const groupes = new Map<string, FrequenceRecette>();
  for (const l of lignes) {
    const cle = cleRecette(l);
    const g = groupes.get(cle);
    if (!g) {
      groupes.set(cle, {
        cle,
        titre: l.titre,
        fois: 1,
        derniere: l.cuisineLe,
        recipeId: l.recipeId,
        recetteRetiree: l.recipeId === null,
      });
      continue;
    }
    const plusRecente = l.cuisineLe.getTime() > g.derniere.getTime();
    groupes.set(cle, {
      ...g,
      fois: g.fois + 1,
      ...(plusRecente
        ? { titre: l.titre, derniere: l.cuisineLe, recipeId: l.recipeId, recetteRetiree: l.recipeId === null }
        : {}),
    });
  }
  return [...groupes.values()].sort(
    (a, b) => b.fois - a.fois || b.derniere.getTime() - a.derniere.getTime(),
  );
}

interface RecetteCuisinee {
  titre: string;
  portions: number;
  recipeId: number | null;
  recetteRetiree: boolean;
}

interface Cuisson {
  cle: string;
  nomBatch: string;
  batchId: number | null;
  cuisineLe: Date;
  /** Date lisible, dans le fuseau de Marc. */
  date: string;
  recettes: RecetteCuisinee[];
}

export interface SemaineHistorique {
  /** Semaine ISO dans le fuseau de Marc, ex. « 2026-W39 ». */
  semaine: string;
  /** Le lundi de cette semaine, lisible. */
  lundi: string;
  cuissons: Cuisson[];
}

/** Le lundi (date civile, fuseau de Marc) de la semaine de `date`, lisible. */
function lundiLisible(date: Date, fuseau: string): string {
  const [a, m, j] = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuseau,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .split("-")
    .map(Number) as [number, number, number];
  // Midi UTC : aucun décalage ne fait changer de jour pendant le calcul.
  const jour = new Date(Date.UTC(a, m - 1, j, 12));
  jour.setUTCDate(jour.getUTCDate() - ((jour.getUTCDay() + 6) % 7));
  return formatDateAjout(jour, "UTC");
}

/**
 * Chronologique : semaines ISO (fuseau de Marc) du plus récent au plus ancien, et dans
 * chacune les cuissons (un batch terminé à un instant donné) du plus récent au plus ancien.
 */
export function regrouperParSemaine(
  lignes: readonly LigneHistorique[],
  fuseau = FUSEAU,
): SemaineHistorique[] {
  const cuissons = new Map<string, Cuisson>();
  // Ordre stable des recettes dans une cuisson : celui des lignes (id croissant).
  for (const l of [...lignes].sort((a, b) => a.id - b.id)) {
    // Un batch supprimé n'a plus d'id : son nom et son instant le distinguent encore.
    const cle = `${l.cuisineLe.getTime()}|${l.batchId ?? `nom:${l.nomBatch}`}`;
    const recette: RecetteCuisinee = {
      titre: l.titre,
      portions: l.portions,
      recipeId: l.recipeId,
      recetteRetiree: l.recipeId === null,
    };
    const c = cuissons.get(cle);
    cuissons.set(
      cle,
      c
        ? { ...c, recettes: [...c.recettes, recette] }
        : {
            cle,
            nomBatch: l.nomBatch,
            batchId: l.batchId,
            cuisineLe: l.cuisineLe,
            date: formatDateAjout(l.cuisineLe, fuseau),
            recettes: [recette],
          },
    );
  }

  const semaines = new Map<string, SemaineHistorique>();
  const recentes = [...cuissons.values()].sort((a, b) => b.cuisineLe.getTime() - a.cuisineLe.getTime());
  for (const c of recentes) {
    const semaine = semaineISO(c.cuisineLe, fuseau);
    const s = semaines.get(semaine);
    semaines.set(
      semaine,
      s ? { ...s, cuissons: [...s.cuissons, c] } : { semaine, lundi: lundiLisible(c.cuisineLe, fuseau), cuissons: [c] },
    );
  }
  return [...semaines.values()];
}

export type EtatHistorique =
  | { type: "vide"; message: string }
  | { type: "rempli"; depuis: string; frequences: FrequenceRecette[]; semaines: SemaineHistorique[] };

/** Ce que l'écran affiche. Vide : un message, aucun chiffre présenté comme une mesure (C8). */
export function etatHistorique(lignes: readonly LigneHistorique[], fuseau = FUSEAU): EtatHistorique {
  if (lignes.length === 0) return { type: "vide", message: MESSAGE_HISTORIQUE_VIDE };
  const premiere = lignes.reduce((min, l) => (l.cuisineLe.getTime() < min.getTime() ? l.cuisineLe : min), lignes[0]!.cuisineLe);
  return {
    type: "rempli",
    depuis: formatDateAjout(premiere, fuseau),
    frequences: regrouperParRecette(lignes),
    semaines: regrouperParSemaine(lignes, fuseau),
  };
}
