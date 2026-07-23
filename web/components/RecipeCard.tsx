// Carte recette avec photo — même rendu partout (accueil, bibliothèque, catalogue).
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
    <Link
      href={href}
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900"
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="aspect-video w-full object-cover" loading="lazy" />
      ) : (
        <div className="aspect-video w-full bg-stone-100 dark:bg-stone-800" />
      )}
      <span className="line-clamp-2 p-3 text-sm font-medium">{title}</span>
    </Link>
  );
}
