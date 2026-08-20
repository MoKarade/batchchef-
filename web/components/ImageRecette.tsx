"use client";

// Image d'une recette, qui DISPARAÎT proprement quand elle ne charge pas (CAT-G).
//
// Les 10 188 recettes du catalogue pointent vers le CDN de leur source. Combien de ces
// adresses sont encore vivantes ? Je n'en sais rien, et je ne peux pas le savoir depuis la
// session : le proxy sortant bloque ce domaine, et il répond « 000 », pas « 404 » — un échec
// de MON réseau, qui ne dit rien de l'image.
//
// D'où ce choix : plutôt qu'une sonde qui produirait un chiffre périmé le lendemain, on
// traite le cas à l'affichage. Une image morte laissait l'icône brisée du navigateur au
// milieu d'une fiche ; elle laisse maintenant la place au reste du contenu. Ça marche quel
// que soit le nombre d'images mortes, et ça continue de marcher quand ce nombre change.
//
// ⚠️ Composant CLIENT : `onError` n'existe pas au rendu serveur. C'est la seule raison de la
// directive ci-dessus — le reste des fiches demeure en Server Component.

import { useState } from "react";

export function ImageRecette({
  src,
  className,
  lazy = false,
}: {
  src: string | null | undefined;
  className?: string;
  lazy?: boolean;
}) {
  const [morte, setMorte] = useState(false);
  if (!src || morte) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={className}
      loading={lazy ? "lazy" : undefined}
      onError={() => setMorte(true)}
    />
  );
}
