// Le stock qui SORT d'un batch : ce qu'il reste à manger, et depuis quand.
//
// Jusqu'ici le cycle s'arrêtait à « terminé » — l'app servait le dimanche et plus rien du
// lundi au samedi, alors que le batch cooking, c'est précisément ce qui vient APRÈS. Ce
// module porte la logique pure de cet écran ; les I/O vivent dans `lib/actions.ts`.
//
// Décision de Marc (17/08/2026) : on compte en PORTIONS (une portion = un repas), et le
// congélateur et le frigo sont DEUX zones distinctes — leurs durées de vie n'ont rien à voir.

export const ZONES = ["frigo", "congelo"] as const;
export type Zone = (typeof ZONES)[number];

export function estZone(valeur: unknown): valeur is Zone {
  return typeof valeur === "string" && (ZONES as readonly string[]).includes(valeur);
}

export const LIBELLE_ZONE: Record<Zone, string> = {
  frigo: "Frigo",
  congelo: "Congélo",
};

/**
 * REPÈRES de conservation, en jours.
 *
 * Ce sont des repères usuels, PAS un verdict sanitaire : l'app ne sait rien de ce qu'il y a
 * vraiment dans la boîte ni de la façon dont elle a été refroidie. D'où le vocabulaire
 * employé à l'écran — « à manger en priorité », jamais « c'est encore bon » ni « périmé ».
 * Le rôle du repère est de faire remonter en tête ce qui attend depuis longtemps.
 */
export const REPERE_JOURS: Record<Zone, number> = {
  frigo: 4,
  congelo: 90,
};

/** Une ligne de stock, telle que la base la rend (le titre est une COPIE, cf. schéma). */
export interface LignePortions {
  id: number;
  titre: string;
  zone: Zone;
  restantes: number;
  rangeLe: Date;
}

const JOUR_MS = 86_400_000;

/**
 * Âge en jours ENTIERS, à partir des dates civiles locales.
 *
 * Une soustraction d'horodatages dirait « 0 jour » pour une portion rangée hier à 23 h et
 * regardée ce matin à 7 h — alors que la réponse attendue, debout devant le frigo, est
 * « hier ». On compare donc des jours de calendrier, pas des durées.
 *
 * Le fuseau est celui de Marc, jamais UTC : Vercel tourne en UTC et daterait du lendemain
 * tout ce qui est rangé après 20 h locale (même piège que JobAI).
 */
export const FUSEAU = "America/Toronto";

function jourCivil(instant: Date): number {
  const [annee, mois, jour] = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSEAU,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(instant)
    .split("-")
    .map(Number);
  // `Date.UTC` sert ici de simple numérotation des jours, pas d'un instant réel.
  return Date.UTC(annee ?? 0, (mois ?? 1) - 1, jour ?? 1) / JOUR_MS;
}

export function ageEnJours(rangeLe: Date, maintenant: Date): number {
  return jourCivil(maintenant) - jourCivil(rangeLe);
}

/** « aujourd'hui » / « hier » / « il y a 5 jours » / « il y a 3 semaines » / « il y a 2 mois ». */
export function formatAge(jours: number): string {
  if (jours <= 0) return "aujourd’hui";
  if (jours === 1) return "hier";
  if (jours < 14) return `il y a ${jours} jours`;
  if (jours < 60) {
    const semaines = Math.floor(jours / 7);
    return `il y a ${semaines} semaines`;
  }
  const mois = Math.floor(jours / 30);
  return `il y a ${mois} mois`;
}

/** A-t-on dépassé le repère de la zone ? (strictement au-delà, pas le jour même) */
export function passeLeRepere(zone: Zone, ageJours: number): boolean {
  return ageJours > REPERE_JOURS[zone];
}

/**
 * Ordre d'affichage : le FRIGO d'abord (il se perd en jours, le congélo en mois), puis le
 * plus ancien en premier dans chaque zone. C'est la réponse à « qu'est-ce que je mange » :
 * ce qui presse en haut.
 *
 * Tri STABLE et total : à âge égal, on départage par titre puis par id, sinon deux portions
 * rangées le même jour changeraient de place d'un rendu à l'autre.
 */
export function trierPortions(lignes: readonly LignePortions[]): LignePortions[] {
  return [...lignes].sort((a, b) => {
    if (a.zone !== b.zone) return a.zone === "frigo" ? -1 : 1;
    const ecart = a.rangeLe.getTime() - b.rangeLe.getTime();
    if (ecart !== 0) return ecart;
    return a.titre.localeCompare(b.titre, "fr") || a.id - b.id;
  });
}

/** Total par zone + total général. Sert à l'accueil et aux en-têtes de zone. */
export function compterPortions(lignes: readonly LignePortions[]): {
  parZone: Record<Zone, number>;
  total: number;
} {
  const parZone: Record<Zone, number> = { frigo: 0, congelo: 0 };
  for (const ligne of lignes) parZone[ligne.zone] += ligne.restantes;
  return { parZone, total: parZone.frigo + parZone.congelo };
}

/** Une ligne de rangement soumise en fin de batch, avant validation. */
export interface RangementBrut {
  recipeId: number;
  titre: string;
  zone: string;
  portions: number;
}

export interface Rangement {
  recipeId: number;
  titre: string;
  zone: Zone;
  portions: number;
}

/**
 * Valide ce que le formulaire de rangement envoie.
 *
 * Les lignes à ZÉRO sont écartées, pas refusées : « je n'ai rien mis au congélo pour cette
 * recette » est une réponse légitime (tout mangé le soir même). Mais une saisie ABSURDE
 * (négatif, non entier, zone inconnue) est refusée en nommant la recette — un message
 * générique obligerait à tout relire pour trouver la ligne fautive.
 */
export function validerRangements(
  brut: readonly RangementBrut[],
): { ok: true; rangements: Rangement[] } | { ok: false; erreur: string } {
  const rangements: Rangement[] = [];
  for (const ligne of brut) {
    const nom = ligne.titre.trim() || `recette ${ligne.recipeId}`;
    if (!estZone(ligne.zone)) return { ok: false, erreur: `« ${nom} » : zone inconnue.` };
    if (!Number.isInteger(ligne.portions) || ligne.portions < 0) {
      return { ok: false, erreur: `« ${nom} » : nombre de portions invalide.` };
    }
    if (ligne.portions === 0) continue;
    rangements.push({
      recipeId: ligne.recipeId,
      titre: nom,
      zone: ligne.zone,
      portions: ligne.portions,
    });
  }
  if (rangements.length === 0) {
    return { ok: false, erreur: "Aucune portion à ranger — mets au moins une ligne à 1." };
  }
  return { ok: true, rangements };
}
