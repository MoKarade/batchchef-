// Carte recette — même rendu partout (accueil, bibliothèque, catalogue).
//
// L'absence de photo est un CAS NORMAL, pas un accident : le catalogue en a rarement, et
// une recette saisie à la main non plus. Un rectangle gris vide donnait l'impression d'un
// chargement qui n'aboutit jamais ; on affiche une marque discrète qui assume le vide.
import Link from "next/link";

export function RecipeCard({
  href,
  title,
  imageUrl,
}: {
  href: string;
  title: string;
  imageUrl: string | null;
}) {
  return (
    <Link href={href} className="carte flex h-full flex-col overflow-hidden">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="aspect-video w-full object-cover" loading="lazy" />
      ) : (
        <div
          className="flex aspect-video w-full items-center justify-center"
          style={{ backgroundColor: "var(--surface-douce)" }}
          aria-hidden
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--texte-doux)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.6"
          >
            <path d="M4 10h16v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-5Z" />
            <path d="M20 11h2M2 11h2" />
          </svg>
        </div>
      )}
      <span className="line-clamp-2 p-3 text-sm font-medium">{title}</span>
    </Link>
  );
}
