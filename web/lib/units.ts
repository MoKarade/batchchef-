// lib/units.ts — normalisation des unités brutes (Marmiton V3) vers le référentiel
// g / ml / unite du nouveau schéma. Fonction PURE et testée.
//
// Règle : masses → g, volumes → ml, pièces → unite. Une unité non convertible en une
// quantité fiable (« pincée », inconnue) devient qty=null/unit=null (« au goût ») —
// on n'invente jamais un poids. Les cuillères sont désambiguïsées via le texte brut
// (« à thé/café » = 5 ml, sinon « à soupe » = 15 ml).

export interface NormalizedQty {
  qty: number | null;
  unit: "g" | "ml" | "unite" | null;
}

/** Multiplicateurs vers l'unité cible. `null` = non convertible → « au goût ». */
const FACTORS: Record<string, { target: "g" | "ml" | "unite"; factor: number } | null> = {
  unite: { target: "unite", factor: 1 },
  g: { target: "g", factor: 1 },
  kg: { target: "g", factor: 1000 },
  mg: { target: "g", factor: 0.001 },
  ml: { target: "ml", factor: 1 },
  cl: { target: "ml", factor: 10 },
  dl: { target: "ml", factor: 100 },
  l: { target: "ml", factor: 1000 },
  tasse: { target: "ml", factor: 250 },
  pincee: null,
  "pincée": null,
};

export function normalizeQty(
  qty: number | null | undefined,
  unit: string | null | undefined,
  rawText = "",
): NormalizedQty {
  if (qty === null || qty === undefined || !Number.isFinite(qty) || qty <= 0) {
    return { qty: null, unit: null };
  }
  const key = (unit ?? "").trim().toLowerCase();

  // Cuillères : « à thé/café » = 5 ml, sinon « à soupe » = 15 ml (défaut).
  if (key.startsWith("cuill") || key.startsWith("c.")) {
    const raw = rawText.toLowerCase();
    const ml = raw.includes("thé") || raw.includes("the") || raw.includes("café") || raw.includes("cafe") ? 5 : 15;
    return { qty: round(qty * ml), unit: "ml" };
  }

  const mapped = FACTORS[key];
  if (mapped === undefined) return { qty: null, unit: null }; // unité inconnue → au goût
  if (mapped === null) return { qty: null, unit: null }; // pincée & co
  return { qty: round(qty * mapped.factor), unit: mapped.target };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
