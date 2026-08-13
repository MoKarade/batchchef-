// Provenance d'une recette : ce que la bibliothèque affiche de son origine.
//
// L'enjeu n'est pas cosmétique. La bibliothèque mélange les recettes que Marc a APPORTÉES
// (une vidéo qu'il a filmée, une page qu'il a trouvée) et celles piochées dans le catalogue
// de 10 188 recettes importées en masse. Attribuer les secondes à Marc serait une fausse
// affirmation sur SES données.

import { describe, expect, it } from "vitest";
import {
  ORIGINES,
  ajouteeParMarc,
  estOrigine,
  formatDateAjout,
  libelleOrigine,
} from "../lib/origine";

describe("estOrigine (garde d'entrée)", () => {
  it("accepte les origines connues", () => {
    for (const o of ORIGINES) expect(estOrigine(o)).toBe(true);
  });

  it("refuse tout le reste — la valeur vient du client, elle n'est pas de confiance", () => {
    expect(estOrigine("Video")).toBe(false); // la casse compte
    expect(estOrigine("")).toBe(false);
    expect(estOrigine(null)).toBe(false);
    expect(estOrigine(undefined)).toBe(false);
    expect(estOrigine(42)).toBe(false);
    expect(estOrigine({ origine: "video" })).toBe(false);
  });
});

describe("libelleOrigine", () => {
  it("dit que c'est Marc qui a ajouté ce qu'il a apporté", () => {
    expect(libelleOrigine("video")).toContain("par toi");
    expect(libelleOrigine("page")).toContain("par toi");
  });

  it("ne s'attribue PAS une recette du catalogue", () => {
    expect(libelleOrigine("catalogue")).not.toContain("par toi");
    expect(libelleOrigine("catalogue")).toContain("catalogue");
  });

  it("une origine ABSENTE se dit, elle ne se devine pas", () => {
    // Les recettes créées avant la colonne ne portent pas l'information. Les afficher
    // comme « ajoutées par toi » attribuerait à Marc des recettes qu'il n'a jamais choisies.
    for (const inconnue of [null, undefined, "", "autre"]) {
      expect(libelleOrigine(inconnue)).toBe("Origine non enregistrée");
      expect(libelleOrigine(inconnue)).not.toContain("par toi");
    }
  });
});

describe("ajouteeParMarc", () => {
  it("distingue ce que Marc a apporté du catalogue et de l'inconnu", () => {
    expect(ajouteeParMarc("video")).toBe(true);
    expect(ajouteeParMarc("page")).toBe(true);
    expect(ajouteeParMarc("catalogue")).toBe(false);
    expect(ajouteeParMarc(null)).toBe(false);
  });
});

describe("formatDateAjout", () => {
  it("date dans le fuseau de Marc, pas celui du serveur", () => {
    // 2026-08-14T01:30Z, c'est encore le 13 août à 21 h 30 au Québec. Vercel tournant en
    // UTC, afficher la date du serveur ferait mentir « ajoutée le … » chaque soirée.
    const soireeQuebecoise = new Date("2026-08-14T01:30:00Z");
    expect(formatDateAjout(soireeQuebecoise)).toContain("13 août 2026");
    // Preuve que le fuseau est bien ce qui décide : en UTC, la même date bascule.
    expect(formatDateAjout(soireeQuebecoise, "UTC")).toContain("14 août 2026");
  });
});
