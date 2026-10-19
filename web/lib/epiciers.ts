// Liens de recherche par épicier (jalon B de la spec « commande d'épicerie », tâche #193).
//
// Module pur : aucun réseau, aucun appel à un épicier. BatchChef ne fait QUE fabriquer une adresse de
// recherche que Marc ouvre d'un clic dans son navigateur (pas de scraping, pas de prix lus, pas de
// panier rempli). Le terme cherché est le nom affiché de l'article, encodé.
//
// Les gabarits ci-dessous sont les adresses de recherche publiques des sites. Aucun n'a pu être ouvert
// depuis un serveur (les cinq sites refusent les robots, HTTP 403) : Marc les a validés un à un dans
// son navigateur le 2026-10-19. Maxi, Metro, Super C et Walmart ouvraient leurs résultats ; l'ancien
// gabarit IGA (www.iga.net/fr/search) menait à une 404, remplacé par l'adresse que Marc a relevée sur
// iga.ca (#254). Un test verrouille l'ordre d'affichage et l'hôte de chaque gabarit.

export interface Epicier {
  /** Identifiant stable (clé React, test). */
  id: "maxi" | "metro" | "iga" | "superc" | "walmart";
  nom: string;
  /** Adresse de recherche, avec `{q}` à la place du terme encodé. */
  gabarit: string;
}

const MAXI: Epicier = { id: "maxi", nom: "Maxi", gabarit: "https://www.maxi.ca/fr/search?search-bar={q}" };

/** Ordre d'affichage : celui de la spec (Maxi, Metro, IGA, Super C, Walmart), à confirmer par Marc. */
export const EPICIERS: readonly Epicier[] = [
  MAXI,
  { id: "metro", nom: "Metro", gabarit: "https://www.metro.ca/epicerie-en-ligne/recherche?filter={q}" },
  { id: "iga", nom: "IGA", gabarit: "https://www.iga.ca/?query={q}&tab=products" },
  { id: "superc", nom: "Super C", gabarit: "https://www.superc.ca/recherche?filter={q}" },
  { id: "walmart", nom: "Walmart", gabarit: "https://www.walmart.ca/fr/search?q={q}" },
];

/** Épicier choisi à l'ouverture : le premier de la liste. */
export const EPICIER_PAR_DEFAUT: Epicier = MAXI;

/**
 * Adresse de recherche de `terme` chez `epicier`. Le terme est nettoyé (espaces) puis encodé :
 * rien de ce qui vient de la base ne peut changer l'hôte ni ajouter un paramètre.
 * `null` quand le terme est vide (pas de lien vers une recherche vide).
 */
export function lienRecherche(epicier: Epicier, terme: string): string | null {
  const propre = terme.replace(/\s+/g, " ").trim();
  if (propre === "") return null;
  return epicier.gabarit.replace("{q}", encodeURIComponent(propre));
}
