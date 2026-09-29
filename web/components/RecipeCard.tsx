// Carte recette — même rendu partout (accueil, bibliothèque, catalogue).
//
// L'absence de photo est un CAS NORMAL, pas un accident : le catalogue en a rarement, et
// une recette saisie à la main non plus. Un rectangle gris vide donnait l'impression d'un
// chargement qui n'aboutit jamais ; on affiche une marque discrète qui assume le vide.
import Link from "next/link";
import { Etoiles } from "@/components/Etoiles";
import { ImageRecette } from "@/components/ImageRecette";

export function RecipeCard({
  href,
  title,
  imageUrl,
  difficulte,
}: {
  href: string;
  title: string;
  imageUrl: string | null;
  /**
   * Difficulté estimée (SEM-05), 1 à 5. ⚠️ TROIS valeurs, TROIS sens distincts :
   * un nombre = une note ; `null` = la recette n'est pas notable (trop peu de signaux),
   * et la carte le DIT ; `undefined` = l'écran n'a pas demandé la note, et la carte
   * n'affiche alors RIEN. Confondre les deux derniers ferait annoncer « non estimée »
   * sur des recettes parfaitement notées, simplement parce qu'une requête a oublié la
   * colonne — un défaut d'affichage qui accuserait la donnée.
   */
  difficulte?: number | null;
}) {
  return (
    <Link href={href} className="carte flex h-full flex-col overflow-hidden">
      {imageUrl ? (
        <ImageRecette src={imageUrl} className="photo" lazy />
      ) : (
        <div className="photo photo-vide" aria-hidden>
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 10h16v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-5Z" />
            <path d="M20 11h2M2 11h2" />
          </svg>
        </div>
      )}
      <div className="carte-corps flex flex-col gap-1">
        <h3 className="line-clamp-2 text-base font-bold">{title}</h3>
        {difficulte !== undefined && <Etoiles etoiles={difficulte} compact />}
      </div>
    </Link>
  );
}
