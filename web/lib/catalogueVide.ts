/** Texte de l'état vide du catalogue. Aucune commande technique n'est montrée à l'écran. */
export function messageCatalogueVide(args: { total: number; typeDemande: boolean }): {
  titre: string;
  texte: string;
} {
  if (args.total === 0) {
    return {
      titre: "Catalogue vide",
      texte: "Le catalogue n’est pas encore rempli. Reviens un peu plus tard.",
    };
  }
  return {
    titre: "Aucun résultat",
    texte: args.typeDemande
      ? "Aucun résultat avec ce type. Le classement est une estimation : essaie « Non déterminé »."
      : "Aucun résultat pour cette recherche.",
  };
}
