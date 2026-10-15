// Liste d'épicerie regroupée par rayon, prête à recopier dans une commande en ligne.
//
// Module pur : aucun accès réseau ni base. Les quantités restent BRUTES (g, ml, unités) :
// aucune taille d'emballage n'existe dans les données réelles, on n'en invente pas (C1).
// Les prix (`estCost`) sont volontairement absents : ce sont des estimations, et un texte
// « prêt à commander » ne doit pas ressembler à un relevé de prix.

import { formatQty } from "./aggregate";
import { RAYONS, rayonDe, type Rayon } from "./rayons";

export interface ArticleListe {
  name: string;
  canonical: string;
  qty: number | null;
  unit: "g" | "ml" | "unite" | null;
  checked: boolean;
}

export interface GroupeRayon {
  rayon: Rayon;
  articles: ArticleListe[];
}

/**
 * Une ligne d'article : « Poulet — 500 g », ou le nom seul quand la quantité est « au goût ».
 * Seul formatage de ligne de l'app : le partage Keep (`buildText`) l'utilise aussi.
 */
export function ligneArticle(a: Pick<ArticleListe, "name" | "qty" | "unit">): string {
  return a.qty !== null ? `${a.name} — ${formatQty(a.qty, a.unit)}` : a.name;
}

/**
 * Regroupe le RESTANT à acheter (articles non cochés) par rayon, dans l'ordre de `RAYONS`,
 * articles triés alphabétiquement dans chaque rayon ; les rayons vides sont omis.
 * Tout coché → toute la liste (même repli que le partage Keep). Aucun article n'est perdu :
 * ce qui n'est reconnu nulle part va dans « Autres ».
 */
export function grouperParRayon(items: readonly ArticleListe[]): GroupeRayon[] {
  const restant = items.filter((i) => !i.checked);
  const liste = restant.length > 0 ? restant : items;
  const parRayon = new Map<Rayon, ArticleListe[]>();
  for (const article of liste) {
    const rayon = rayonDe(article.canonical, article.name);
    parRayon.set(rayon, [...(parRayon.get(rayon) ?? []), article]);
  }
  return RAYONS.filter((r) => parRayon.has(r)).map((rayon) => ({
    rayon,
    articles: [...(parRayon.get(rayon) ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name, "fr", { sensitivity: "base" }),
    ),
  }));
}

/**
 * Texte à copier : un paragraphe par rayon (« Rayon : » puis une ligne par article).
 * `null` quand il n'y a rien à copier.
 */
export function construireTexteParRayon(
  batchName: string,
  items: readonly ArticleListe[],
): { title: string; body: string } | null {
  const groupes = grouperParRayon(items);
  if (groupes.length === 0) return null;
  const body = groupes
    .map((g) => [`${g.rayon} :`, ...g.articles.map(ligneArticle)].join("\n"))
    .join("\n\n");
  return { title: `Épicerie par rayon — ${batchName}`, body };
}
