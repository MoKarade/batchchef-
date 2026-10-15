// Composer un batch depuis une recette : « ?recette=12 » coche déjà cette recette.
// Un identifiant absent, mal formé ou qui n'est pas dans la bibliothèque est IGNORÉ
// (rien de coché), jamais deviné.

export function portionsInitiales(
  recettes: { id: number; servings: number }[],
  recetteDemandee: string | undefined,
): Record<number, number> {
  const id = Number(recetteDemandee);
  if (!Number.isInteger(id)) return {};
  const trouvee = recettes.find((r) => r.id === id);
  return trouvee ? { [trouvee.id]: trouvee.servings } : {};
}
