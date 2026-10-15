// Page « introuvable » : un lien mort (batch ou recette supprimé, adresse mal tapée)
// tombe ici au lieu de l'écran anglais par défaut de Next.js.
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Cette page n’existe plus</h1>
      <p className="doux">Le lien est peut-être ancien, ou l’élément a été supprimé.</p>
      <Link href="/" className="bouton bouton-principal w-full">
        Accueil
      </Link>
    </div>
  );
}
