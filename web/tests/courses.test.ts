// Avancement de la liste d'épicerie — ce qui se lit en haut de l'écran au magasin.

import { describe, expect, it } from "vitest";
import { formatMontant, progressionCourses } from "../lib/courses";

const pris = (estCost: number | null = 1) => ({ checked: true, estCost });
const aPrendre = (estCost: number | null = 1) => ({ checked: false, estCost });

describe("progressionCourses", () => {
  it("compte les articles pris et le pourcentage", () => {
    const p = progressionCourses([pris(), pris(), aPrendre(), aPrendre()]);
    expect(p.pris).toBe(2);
    expect(p.total).toBe(4);
    expect(p.pourcentage).toBe(50);
    expect(p.termine).toBe(false);
  });

  it("une liste VIDE vaut 0 %, surtout pas « terminé »", () => {
    // 0/0 = NaN, et un raccourci « pris === total » ferait afficher « tout est pris » sur
    // une liste qu'on n'a jamais remplie.
    const p = progressionCourses([]);
    expect(p.pourcentage).toBe(0);
    expect(p.termine).toBe(false);
  });

  it("« terminé » seulement quand tout est réellement coché", () => {
    expect(progressionCourses([pris(), pris()]).termine).toBe(true);
    expect(progressionCourses([pris(), aPrendre()]).termine).toBe(false);
  });

  it("ne somme que le RESTANT — ce qui est dans le panier est déjà payé", () => {
    const p = progressionCourses([pris(10), aPrendre(3), aPrendre(4)]);
    expect(p.restantEstime).toBe(7);
  });

  it("SIGNALE un montant incomplet plutôt que d'afficher un total qui n'en est pas un", () => {
    // Sans ce drapeau, « reste 7 $ » se lirait comme un total alors qu'un article restant
    // n'a aucun coût estimé : le nombre serait juste et l'impression fausse.
    expect(progressionCourses([aPrendre(3), aPrendre(4)]).montantIncomplet).toBe(false);
    expect(progressionCourses([aPrendre(3), aPrendre(null)]).montantIncomplet).toBe(true);
  });

  it("un article SANS coût déjà pris ne rend pas le montant incomplet", () => {
    // Il ne reste rien à payer pour lui : son absence de prix ne change plus rien.
    expect(progressionCourses([pris(null), aPrendre(4)]).montantIncomplet).toBe(false);
  });
});

describe("formatMontant", () => {
  it("formate en dollars canadiens", () => {
    expect(formatMontant(12.5)).toContain("12,50");
    expect(formatMontant(0)).toContain("0,00");
  });
});
