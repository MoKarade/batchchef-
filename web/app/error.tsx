"use client";

// Page d'erreur : quand une page plante (base lente ou en panne), un message clair et un
// bouton « Réessayer » à la place de l'écran anglais « Application error ».
// Le détail technique n'est jamais affiché à l'écran.

export default function ErreurPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-4" role="alert">
      <h1 className="text-xl font-semibold">Oups, quelque chose n’a pas marché</h1>
      <p className="doux">La page n’a pas pu s’afficher. Réessaie dans un instant.</p>
      <button type="button" onClick={reset} className="bouton bouton-principal w-full">
        Réessayer
      </button>
    </div>
  );
}
