// lib/semaine.ts — la proposition hebdomadaire (SEM-02). Module PUR : aucune base, aucun
// réseau, aucune horloge — la date et les données arrivent en paramètre. C'est ce qui rend
// le tirage testable, et surtout REJOUABLE : même semaine, même proposition.
//
// Ce que Marc a arbitré le 14/09/2026 :
//   - quatre recettes à CUISINER, sans jour assigné (BatchChef est un planificateur de batch,
//     pas un menu quotidien) ;
//   - la semaine se fabrique à l'ouverture de l'app, pas par un cron (le plan Vercel gratuit
//     n'accepte que des crons quotidiens, et une proposition que personne ne regarde n'a pas
//     besoin d'exister) ;
//   - elle se fonde sur ce qui est MESURÉ — les temps, réels sur les 10 188 recettes — et sur
//     la variété des ingrédients ; le classement (type de plat, végé, effort) viendra avec
//     `SEM-01` et s'y branchera sans rien casser ;
//   - une seule semaine vivante : la nouvelle remplace l'ancienne.
//
// ⚠️ Conséquence de ce dernier choix, et c'est une décision à moi : sans historique des
// PROPOSITIONS, l'anti-répétition ne peut pas s'appuyer dessus. Elle s'appuie donc sur les
// BATCHS, qui sont persistés de toute façon. C'est plus juste — on évite ce que Marc a
// CUISINÉ, pas ce qu'on lui a MONTRÉ —, mais ça se dit : tant qu'il n'a aucun batch, ce
// filtre ne retire rien.

import { FUSEAU } from "./origine";

/** Quatre, parce que c'est ce que Marc a demandé. */
export const RECETTES_PAR_SEMAINE = 4;

/**
 * Au-delà de cette part des recettes, un ingrédient ne distingue plus rien.
 *
 * ⚠️ MESURÉ sur le corpus (14/09/2026), jamais choisi au jugé : à 2 %, **50 ingrédients sur
 * 15 389** passent « communs » — oeufs 28,8 %, sel 22,5 %, farine 19,8 %, poivre 19,7 %,
 * beurre 19,0 %, oignons 15,0 %, ail 14,3 %, sucre 14,0 %, huile d'olive 12,8 %, lait 9,7 %,
 * eau 6,8 %, carottes 5,8 %, tomates 4,7 %, courgettes 4,2 %… — et **58 recettes sur 10 185**
 * n'ont alors plus aucun ingrédient distinctif. Les seuils voisins ont été mesurés aussi
 * (3 % → 27 communs, 10 recettes sans distinctif ; 5 % → 18 communs, 4 recettes) : 2 % est
 * celui qui écarte les banalités sans vider les recettes de leur identité.
 *
 * ⚠️ La mesure vient du seed, dont les clés d'ingrédients sont ANTÉRIEURES à la réparation
 * `ING-03`. En production, la réparation FUSIONNE des clés (« ousses_d'ail » et « gousses
 * d'ail » deviennent une seule) : les communs y sont donc un peu plus fréquents, et la
 * contrainte de variété un peu plus permissive. Jamais l'inverse.
 */
export const SEUIL_COMMUN = 0.02;

/**
 * Combien de recettes la production tire du catalogue AVANT d'appeler `choisirQuatre`.
 *
 * ⚠️ Pourquoi une présélection : charger les 87 444 lignes d'ingrédients du catalogue à
 * chaque fabrication de semaine coûterait plusieurs mégaoctets dans une fonction serverless,
 * pour en retenir quatre. Le tirage se fait donc en deux temps — un échantillon déterministe
 * en SQL, puis le choix ici.
 *
 * ⚠️ MESURÉ sur 52 semaines simulées (14/09/2026) : la contrainte de variété tient déjà à
 * **40** recettes (0 relâchement sur 52), et à 200 l'échange « au moins une courte » n'est
 * sollicité que 5 fois sur 52. 200 est donc une marge confortable, pas un chiffre rond —
 * et `tests/semaine.test.ts` éprouve la propriété sur des présélections de CETTE taille,
 * parce qu'une garantie prouvée sur les 10 188 ne dirait rien de ce que la production fait.
 */
export const TAILLE_PRESELECTION = 200;

/**
 * Au-delà, ce n'est plus une recette « courte ».
 *
 * ⚠️ MESURÉ sur les 9 901 recettes dont le temps total est exploitable : p10 = 15 min,
 * p25 = 25, **médiane = 40**, p75 = 58, p90 = 80. Trente minutes tombe entre le premier
 * quartile et la médiane — assez bas pour vouloir dire quelque chose, assez haut pour qu'il
 * en existe toujours une.
 */
export const MINUTES_COURTE = 30;

/** Une recette du catalogue, réduite à ce qui décide de sa sélection. */
export interface CandidateSemaine {
  id: number;
  titre: string;
  /** Minutes, telles que le catalogue les porte. `null` = la source ne dit rien. */
  prepMinutes: number | null;
  cuissonMinutes: number | null;
  /**
   * Ses ingrédients DISTINCTIFS (clés canoniques), c'est-à-dire ceux que `estCommun` n'a pas
   * écartés. L'appelant les calcule — la fréquence se lit en base, pas ici.
   */
  distinctifs: readonly string[];
}

export interface Tirage {
  recettes: CandidateSemaine[];
  /**
   * `true` quand il a fallu accepter deux recettes qui partagent un ingrédient distinctif
   * pour arriver à quatre. Sur 10 188 recettes ça n'arrive pas ; sur un petit corpus, si —
   * et rendre trois recettes en silence serait pire que le dire.
   */
  varieteRelachee: boolean;
  /** `true` quand aucune des quatre ne descend sous `MINUTES_COURTE`. */
  sansCourte: boolean;
}

/** Un ingrédient présent dans plus de `SEUIL_COMMUN` des recettes ne distingue plus rien. */
export function estCommun(occurrences: number, totalRecettes: number, seuil = SEUIL_COMMUN): boolean {
  if (!Number.isFinite(occurrences) || !Number.isFinite(totalRecettes) || totalRecettes <= 0) return false;
  return occurrences / totalRecettes > seuil;
}

/**
 * Le temps total, ou `null` quand la source ne dit rien.
 *
 * ⚠️ Zéro n'est pas « instantané », c'est une donnée MANQUANTE — même règle que
 * `lib/tempsRecette.ts`, et 224 recettes du corpus sont dans ce cas. Les deux à zéro ⇒ on ne
 * sait pas, donc on ne prétend rien.
 */
export function tempsTotal(c: Pick<CandidateSemaine, "prepMinutes" | "cuissonMinutes">): number | null {
  const p = c.prepMinutes ?? 0;
  const k = c.cuissonMinutes ?? 0;
  const t = p + k;
  return t > 0 ? t : null;
}

/** Courte = un temps total CONNU et sous le seuil. Un temps inconnu n'est pas court. */
export function estCourte(c: Pick<CandidateSemaine, "prepMinutes" | "cuissonMinutes">): boolean {
  const t = tempsTotal(c);
  return t !== null && t <= MINUTES_COURTE;
}

/**
 * Empreinte 32 bits (FNV-1a) d'une chaîne. Sert à ordonner les candidates de façon
 * pseudo-aléatoire mais DÉTERMINISTE : la graine est la semaine, donc rafraîchir la page ne
 * change pas la proposition, et deux semaines de suite n'en donnent pas la même.
 */
export function empreinte(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * La semaine ISO de `date`, dans le fuseau de Marc — « 2026-W38 ».
 *
 * ⚠️ Le fuseau n'est pas cosmétique et c'est le même piège que `formatDateAjout` : Vercel
 * tourne en UTC, donc un dimanche à 20 h heure du Québec est déjà lundi en UTC. Sans le
 * fuseau, la semaine basculerait quatre heures trop tôt, une fois sur sept.
 */
export function semaineISO(date: Date, fuseau = FUSEAU): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error("semaineISO : date invalide.");
  }
  // « 2026-09-14 » chez Marc, quelle que soit l'heure du serveur.
  const [a, m, j] = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuseau,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .split("-")
    .map(Number) as [number, number, number];

  // Semaine ISO : lundi ouvre la semaine, et la semaine 1 est celle du premier jeudi.
  // On travaille en UTC à midi pour qu'aucun décalage ne fasse changer de jour.
  const jour = new Date(Date.UTC(a, m - 1, j, 12));
  const jourSemaine = (jour.getUTCDay() + 6) % 7; // 0 = lundi
  jour.setUTCDate(jour.getUTCDate() - jourSemaine + 3); // le jeudi de cette semaine
  const anneeISO = jour.getUTCFullYear();
  const premierJeudi = new Date(Date.UTC(anneeISO, 0, 4, 12));
  premierJeudi.setUTCDate(premierJeudi.getUTCDate() - ((premierJeudi.getUTCDay() + 6) % 7) + 3);
  const numero = 1 + Math.round((jour.getTime() - premierJeudi.getTime()) / (7 * 24 * 3600 * 1000));
  return `${anneeISO}-W${String(numero).padStart(2, "0")}`;
}

/**
 * Choisit les quatre recettes de la semaine.
 *
 * Trois règles, dans cet ordre : on écarte ce qui est déjà passé en cuisine, on parcourt les
 * candidates dans un ordre déterministe tiré de `graine`, et on refuse une recette qui
 * partage un ingrédient distinctif avec une déjà retenue. Si les quatre retenues sont toutes
 * longues, on échange la dernière contre la plus courte disponible qui respecte la variété.
 *
 * ⚠️ On rend TOUJOURS quatre recettes si le corpus le permet, quitte à relâcher la variété —
 * mais alors `varieteRelachee` le dit. Rendre trois recettes sans explication serait pire.
 */
export function choisirQuatre(
  candidates: readonly CandidateSemaine[],
  dejaCuisinees: Iterable<number>,
  graine: string,
  combien = RECETTES_PAR_SEMAINE,
): Tirage {
  const exclues = new Set(dejaCuisinees);
  const eligibles = candidates.filter((c) => !exclues.has(c.id));

  // Ordre déterministe : l'empreinte de (graine, id). Départage par id pour que deux
  // empreintes égales ne dépendent pas de l'ordre d'arrivée des lignes SQL.
  const ordonnees = [...eligibles].sort((x, y) => {
    const ex = empreinte(`${graine}:${x.id}`);
    const ey = empreinte(`${graine}:${y.id}`);
    return ex === ey ? x.id - y.id : ex - ey;
  });

  const retenues: CandidateSemaine[] = [];
  const pris = new Set<string>();
  const compatible = (c: CandidateSemaine, deja: ReadonlySet<string>): boolean =>
    !c.distinctifs.some((d) => deja.has(d));

  for (const c of ordonnees) {
    if (retenues.length >= combien) break;
    if (!compatible(c, pris)) continue;
    retenues.push(c);
    for (const d of c.distinctifs) pris.add(d);
  }

  // Pas assez de recettes compatibles : on complète sans la contrainte de variété, et on le dit.
  let varieteRelachee = false;
  if (retenues.length < combien) {
    const dejaLa = new Set(retenues.map((c) => c.id));
    for (const c of ordonnees) {
      if (retenues.length >= combien) break;
      if (dejaLa.has(c.id)) continue;
      retenues.push(c);
      dejaLa.add(c.id);
      varieteRelachee = true;
    }
  }

  // Au moins une courte. On n'échange que si l'échange est possible SANS casser la variété
  // des trois premières — sinon on garde le tirage et `sansCourte` le dit.
  if (retenues.length === combien && !retenues.some(estCourte)) {
    const gardees = retenues.slice(0, combien - 1);
    const prisSansDerniere = new Set(gardees.flatMap((c) => [...c.distinctifs]));
    const dejaLa = new Set(retenues.map((c) => c.id));
    const remplacante = ordonnees.find(
      (c) => !dejaLa.has(c.id) && estCourte(c) && compatible(c, prisSansDerniere),
    );
    if (remplacante) retenues[combien - 1] = remplacante;
  }

  return {
    recettes: retenues,
    varieteRelachee,
    sansCourte: !retenues.some(estCourte),
  };
}
