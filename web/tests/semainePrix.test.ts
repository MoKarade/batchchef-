// Verrou du prix de la semaine (SEM-05).
//
// `prixSemaine` fait des I/O (base + appel LLM) : aucun test unitaire ne peut l'exécuter ici.
// Ce qui se vérifie, et qui est justement ce qui casse en silence, c'est la SURFACE : par
// quelles fonctions le chiffre passe, et ce qui déclenche son recalcul.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Le corps de `prixSemaine`, décommenté — un commentaire ne satisfait aucune garde. */
function corpsPrixSemaine(): string {
  const brut = readFileSync(resolve(process.cwd(), "lib/semaineDb.ts"), "utf8");
  const bloc = /export async function prixSemaine[\s\S]*?\n\}/.exec(brut)?.[0];
  expect(bloc, "la fonction prixSemaine doit exister").toBeTruthy();
  return (bloc ?? "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*"))
    .join("\n");
}

describe("le prix de la semaine passe par les mêmes fonctions que le batch", () => {
  it("agrège, écarte le sel, estime et comble — les quatre, dans le même ordre que le batch", () => {
    // ⚠️ Le risque de ce lot n'est pas qu'une fonction soit fausse, c'est que le prix de la
    // SEMAINE et celui du BATCH divergent : Marc verrait un chiffre avant de monter le batch,
    // un autre après, pour exactement les mêmes courses. Deux implémentations d'une même
    // règle, c'est une règle et demie.
    const code = corpsPrixSemaine();
    expect(code.length, "le décommentage ne doit pas avoir tout mangé").toBeGreaterThan(600);

    const etapes = [
      "aggregateShoppingList",
      "ecarterIngredientsDeFond",
      "estimateShoppingCosts",
      "fillMissingCosts",
    ];
    let position = -1;
    for (const e of etapes) {
      const i = code.indexOf(`${e}(`);
      expect(i, `${e} doit être appelée`).toBeGreaterThan(-1);
      expect(i, `${e} doit venir après l'étape précédente`).toBeGreaterThan(position);
      position = i;
    }
  });

  it("le sel, le poivre et l'eau sortent du prix comme ils sortent de la liste", () => {
    // Le batch les écarte (décision de Marc, 17/08). Un prix qui les compterait annoncerait
    // plus cher que la liste que Marc verra ensuite — et l'écart serait inexplicable.
    const code = corpsPrixSemaine();
    const iEcart = code.indexOf("ecarterIngredientsDeFond(");
    const iEstime = code.indexOf("estimateShoppingCosts(");
    expect(iEcart).toBeGreaterThan(-1);
    expect(iEcart, "on écarte AVANT d'estimer, sinon on paie ce qu'on n'achète pas").toBeLessThan(iEstime);
  });

  it("⚠️ la composition est comparée avant de servir un prix mémorisé", () => {
    // Sans cette comparaison, remplacer une recette laisserait le prix de l'ANCIENNE
    // composition à l'écran : un chiffre qui décrit une semaine qui n'existe plus, avec
    // l'exacte apparence d'une mesure.
    const code = corpsPrixSemaine();
    expect(code, "la signature doit être calculée").toMatch(/signatureDe\s*\(/);
    expect(code, "et COMPARÉE à celle du prix mémorisé").toMatch(/\.signature\s*===\s*signature/);
  });

  it("un échec d'estimation change la MÉTHODE, il n'efface pas le prix", () => {
    // Le filet déterministe donne un prix à tout ; ce qui ne doit pas se perdre, c'est
    // l'aveu que le chiffre est plus grossier.
    const code = corpsPrixSemaine();
    expect(code).toMatch(/catch\s*\{[\s\S]{0,300}?methode\s*=\s*"filet"/);
  });
});
