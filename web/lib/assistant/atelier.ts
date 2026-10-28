// lib/assistant/atelier.ts — la réponse de l'assistant, mise en forme pour l'atelier de LIA (fonctions pures).
//
// Le moteur (`boucle.ts`) rend un texte où les recettes sont citées par des marqueurs « [catalogue #482] » et les
// remplacements par « [semaine 3 ← catalogue #482] ». Dans l'atelier le texte est affiché par `textContent` : un marqueur
// resterait du code brut. On le RETIRE du texte et on le range en bloc (`recette`, `placement`), que l'hôte dessine en bouton et
// en carte. Le texte autour est conservé mot pour mot.

import { BlocAtelier } from "@/lib/lia/contrat";
import { decouperReponse, referencesDe, type ReferenceRecette } from "./protocole";

/** Clé d'une recette citée, pour la table des titres. */
export const cleRecette = (source: ReferenceRecette["source"], id: number): string => `${source}#${id}`;

/** Ce qu'il y a à retrouver en base pour mettre des titres sur les références d'une réponse. */
export function referencesATitrer(texte: string): ReferenceRecette[] {
  return referencesDe(texte);
}

/**
 * Le texte sans marqueurs et les blocs qui les remplacent.
 *
 * ⚠️ Une référence dont le titre est inconnu (`titres` ne l'a pas : la recette n'existe pas) ne donne AUCUN bouton : le modèle
 * a pu inventer un numéro, et un bouton vers du vide est une promesse non tenue. Un remplacement garde sa carte même si la
 * recette manque : la carte charge son aperçu et DIT l'erreur.
 */
export function versReponseAtelier(
  texte: string,
  titres: ReadonlyMap<string, string>,
): { text: string; blocks: BlocAtelier[] } {
  const blocks: BlocAtelier[] = [];
  const vues = new Set<string>();
  let propre = "";
  for (const seg of decouperReponse(texte)) {
    if (seg.type === "texte") {
      propre += seg.valeur;
    } else if (seg.type === "reference") {
      const cle = cleRecette(seg.source, seg.id);
      const titre = titres.get(cle);
      if (titre && !vues.has(cle)) {
        vues.add(cle);
        blocks.push({ type: "recette", source: seg.source, id: seg.id, titre });
      }
    } else {
      const cle = `place${seg.place}`;
      if (!vues.has(cle)) {
        vues.add(cle);
        blocks.push({ type: "placement", place: seg.place, id: seg.id });
      }
    }
  }
  const text = propre
    .replace(/[ \t]+(\r?\n)/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Une réponse faite des seuls marqueurs : les blocs parlent, le texte dit seulement où regarder.
  return { text: text || (blocks.length > 0 ? "Voici ce que j'ai trouvé dans ta base." : texte.trim()), blocks };
}

/** Les blocs valides d'une réponse ; les autres sont écartés, pas devinés (catalogue fermé : `BlocAtelier`). */
export function blocsValides(blocs: readonly unknown[]): BlocAtelier[] {
  return blocs.flatMap((b) => {
    const lu = BlocAtelier.safeParse(b);
    return lu.success ? [lu.data] : [];
  });
}
