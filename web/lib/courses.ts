// lib/courses.ts — l'avancement d'une liste d'épicerie, en fonctions PURES.
//
// Ce qui se lit en haut de l'écran pendant qu'on pousse un panier : combien d'articles
// restent, et ce que ça pèse encore. Isolé ici parce que c'est la seule partie décidable,
// donc la seule testable — le reste est de la mise en page.

export interface ArticleCourses {
  checked: boolean;
  /** Coût ESTIMÉ par le LLM. `null` = inclassable, jamais 0 « pour faire joli ». */
  estCost: number | null;
}

export interface Progression {
  pris: number;
  total: number;
  /** 0 à 100, entier. Une liste vide vaut 0 — surtout pas 100 (« terminé »). */
  pourcentage: number;
  /** Somme des coûts estimés RESTANTS. */
  restantEstime: number;
  /**
   * `true` si au moins un article restant n'a AUCUN coût estimé.
   *
   * ⚠️ Sans ce drapeau, un total partiel s'affiche comme un total complet : Marc lirait
   * « restant 12 $ » alors que trois articles non chiffrés manquent à l'appel. Le montant
   * serait juste et l'impression fausse.
   */
  montantIncomplet: boolean;
  termine: boolean;
}

export function progressionCourses(articles: ArticleCourses[]): Progression {
  const total = articles.length;
  const pris = articles.filter((a) => a.checked).length;
  const restants = articles.filter((a) => !a.checked);
  return {
    pris,
    total,
    pourcentage: total === 0 ? 0 : Math.round((pris / total) * 100),
    restantEstime: restants.reduce((somme, a) => somme + (a.estCost ?? 0), 0),
    montantIncomplet: restants.some((a) => a.estCost === null),
    termine: total > 0 && pris === total,
  };
}

/** Montant en dollars canadiens, format québécois. */
export function formatMontant(valeur: number): string {
  return valeur.toLocaleString("fr-CA", { style: "currency", currency: "CAD" });
}
