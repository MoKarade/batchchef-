// Décide QUELLES recettes du catalogue retirer (CAT-E). Module PUR : il ne supprime rien,
// il rend une liste d'URL sources. La suppression, elle, vit dans la passe de déploiement.
//
// ⚠️ UN TRAITEMENT QUI RETIRE SE CONÇOIT À L'ENVERS : d'abord ce qu'il n'a PAS le droit de
// toucher. Mon premier cadrage annonçait 40 recettes à supprimer et il était FAUX — les 22
// « recettes à un seul ingrédient » sont des recettes normales (Oeufs durs, Purée d'amande,
// les cinq confitures de lait déclinées par appareil). Les avoir regardées une par une avant
// d'écrire ce fichier est la seule raison pour laquelle elles existent encore.
//
// Ce qui part, décidé par Marc le 20/08 après lui avoir montré les trois piles :
//   1. une recette SANS ingrédient ET SANS instructions — elle n'a rien à offrir ;
//   2. une recette sans ingrédient mais avec un texte — donnée perdue, invérifiable ;
//   3. le doublon d'un groupe qui partage titre ET liste d'ingrédients.
//
// ⚠️ ON NE DÉDOUBLONNE JAMAIS PAR TITRE SEUL. Mesuré : sur 87 titres partagés, 72 sont des
// VARIANTES réelles — deux « sauce bolognaise » qui n'ont pas les mêmes ingrédients. Le titre
// est un indice, la liste d'ingrédients est la preuve.

/** Une recette du seed, réduite à ce qui décide de son sort. */
export interface RecetteCandidate {
  /** `marmiton_url` : identifiant STABLE, indépendant des ids de production. */
  url: string;
  titre: string;
  instructions: string;
  /** Les textes source de ses ingrédients, dans n'importe quel ordre. */
  ingredients: readonly string[];
}

export type Motif = "vide" | "sansIngredient" | "doublon";

export interface Retrait {
  url: string;
  motif: Motif;
  /** Pour un doublon : l'URL de l'exemplaire CONSERVÉ. Rend la décision relisible. */
  garde?: string;
}

/**
 * Plafond de sécurité. Le corpus est FIGÉ (il est committé), donc le nombre de retraits est
 * connu : 18. Le jour où une modification de ces règles ferait déborder ce compte, on veut un
 * échec bruyant, pas un catalogue amputé en silence pendant qu'un build reste vert.
 *
 * ⚠️ La marge est étroite EXPRÈS. Un plafond large ne protège de rien.
 */
export const PLAFOND_RETRAITS = 25;

const cle = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/** La signature d'une recette : sa liste d'ingrédients, ordre indifférent. */
const signature = (r: RecetteCandidate): string =>
  r.ingredients.map(cle).filter(Boolean).sort().join(" ");

export function retraitsCatalogue(recettes: readonly RecetteCandidate[]): Retrait[] {
  const retraits: Retrait[] = [];
  const dejaRetire = new Set<string>();

  for (const r of recettes) {
    if (r.ingredients.length > 0) continue;
    const motif: Motif = r.instructions.trim() ? "sansIngredient" : "vide";
    retraits.push({ url: r.url, motif });
    dejaRetire.add(r.url);
  }

  // Groupes (titre + signature d'ingrédients). Une recette sans ingrédient est déjà partie,
  // et sa signature vide ferait un faux groupe : on l'exclut d'abord.
  const groupes = new Map<string, RecetteCandidate[]>();
  for (const r of recettes) {
    if (dejaRetire.has(r.url)) continue;
    const k = `${cle(r.titre)} ${signature(r)}`;
    const g = groupes.get(k) ?? [];
    g.push(r);
    groupes.set(k, g);
  }

  for (const g of groupes.values()) {
    if (g.length < 2) continue;
    // On garde l'URL qui vient en premier dans l'ordre alphabétique : un critère STABLE,
    // indépendant des ids de production, donc la passe rend le même verdict à chaque build.
    const ordonne = [...g].sort((a, b) => a.url.localeCompare(b.url));
    const garde = ordonne[0]!;
    for (const r of ordonne.slice(1)) {
      retraits.push({ url: r.url, motif: "doublon", garde: garde.url });
    }
  }

  return retraits;
}
