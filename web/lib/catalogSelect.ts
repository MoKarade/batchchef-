// lib/catalogSelect.ts — logique PURE de l'ajout massif depuis le catalogue (testable
// sans base). Sépare ce qui est nouveau de ce qui existe déjà, pour ne jamais dupliquer
// une recette déjà dans la bibliothèque (l'ajout massif est idempotent sur la source).

export interface CatalogPick {
  id: number;
  sourceUrl: string | null;
}

export interface SplitResult<T extends CatalogPick> {
  toAdd: T[];
  skipped: number;
}

/**
 * Sépare les recettes du catalogue à ajouter de celles déjà présentes (même sourceUrl).
 * Une recette sans sourceUrl est toujours ajoutée (rien à quoi la comparer).
 */
export function splitNewCatalogRecipes<T extends CatalogPick>(
  picks: T[],
  existingSourceUrls: Iterable<string>,
): SplitResult<T> {
  const seen = new Set<string>();
  for (const url of existingSourceUrls) {
    const key = url.trim();
    if (key) seen.add(key);
  }
  const toAdd: T[] = [];
  let skipped = 0;
  for (const pick of picks) {
    const key = pick.sourceUrl?.trim();
    if (key && seen.has(key)) {
      skipped++;
      continue;
    }
    if (key) seen.add(key); // dédoublonne aussi au sein de la sélection
    toAdd.push(pick);
  }
  return { toAdd, skipped };
}
