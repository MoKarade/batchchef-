// lib/recipeEdit.ts — logique PURE de l'édition d'une recette (testable sans base).
// Nettoie les lignes saisies par Marc : trim, canonical dérivé du nom, quantité/unité
// cohérentes (« au goût » = pas de quantité → pas d'unité). Une ligne sans nom est ignorée.

export interface EditableIngredient {
  name: string;
  qty: number | null;
  unit: "g" | "ml" | "unite" | null;
  note: string | null;
}

export interface PreparedIngredient {
  name: string;
  canonical: string;
  qty: number | null;
  unit: "g" | "ml" | "unite" | null;
  note: string | null;
}

/**
 * Normalise le lien de source saisi par Marc, ou rend `null`.
 *
 * ⚠️ Ce lien devient un `<a href>` sur la page de recette. Depuis qu'il est ÉDITABLE à
 * l'écran de validation, il n'est plus filtré par le chemin d'import qui le validait en
 * amont : sans cette garde, un `javascript:…` collé par mégarde deviendrait un lien
 * exécutable. Seuls http et https passent — même règle que côté partage.
 *
 * Une chaîne vide rend `null` (pas de lien), ce qui est un état normal, pas une erreur.
 */
export function normaliserLienSource(valeur: string | null | undefined): {
  lien: string | null;
  valide: boolean;
} {
  const brut = (valeur ?? "").trim();
  if (!brut) return { lien: null, valide: true };
  try {
    const parsed = new URL(brut);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { lien: null, valide: false };
    }
    return { lien: parsed.toString(), valide: true };
  } catch {
    return { lien: null, valide: false };
  }
}

/** Taille maximale d'une photo de recette embarquée (data: URL). ~40 Ko attendus. */
export const MAX_IMAGE_OCTETS = 300_000;

/**
 * Normalise la photo d'une recette : URL http(s) d'un site, ou image EMBARQUÉE en data:
 * (la vignette tirée d'une vidéo, qui n'a pas d'URL puisqu'elle n'existe nulle part ailleurs).
 *
 * ⚠️ Cette valeur devient un `<img src>`. Elle vient soit d'un modèle, soit du client :
 * aucune des deux n'est de confiance. On n'accepte donc QUE http(s) et data:image, et on
 * borne la taille — une data: URL non bornée est un moyen simple de faire grossir la base
 * sans que personne ne s'en aperçoive.
 */
export function normaliserImage(valeur: string | null | undefined): string | null {
  const brut = (valeur ?? "").trim();
  if (!brut) return null;
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(brut)) {
    return brut.length <= MAX_IMAGE_OCTETS ? brut : null;
  }
  try {
    const parsed = new URL(brut);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Borne le nombre de portions de référence à un entier valide (1…50). */
export function clampServings(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(50, Math.round(n)));
}

/** Transforme les lignes éditées en lignes prêtes à insérer (canonical dérivé, cohérence qty/unit). */
export function prepareIngredientRows(rows: EditableIngredient[]): PreparedIngredient[] {
  const out: PreparedIngredient[] = [];
  for (const r of rows) {
    const name = r.name.trim();
    if (!name) continue; // ligne vide → ignorée
    // Quantité valide seulement si > 0 ; sinon « au goût » (qty ET unit à null).
    const qty = r.qty !== null && Number.isFinite(r.qty) && r.qty > 0 ? r.qty : null;
    const note = r.note?.trim() ? r.note.trim() : null;
    out.push({
      name,
      canonical: name.toLowerCase(),
      qty,
      unit: qty === null ? null : r.unit,
      note,
    });
  }
  return out;
}
