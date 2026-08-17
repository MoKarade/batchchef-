// Le stock qui sort d'un batch : âge, ordre, comptage, validation du rangement.
//
// Tout ce qui décide de ce que Marc voit debout devant son congélateur vit dans des
// fonctions pures — c'est ce qui rend l'écran vérifiable sans base de données.

import { describe, expect, it } from "vitest";
import {
  ageEnJours,
  compterPortions,
  estZone,
  formatAge,
  passeLeRepere,
  trierPortions,
  validerRangements,
  type LignePortions,
} from "../lib/portions";

/** Un instant DANS la journée locale du jour donné (midi : à l'abri des bords de fuseau). */
const midi = (iso: string) => new Date(`${iso}T16:00:00Z`); // 12 h à Toronto (UTC−4)

function ligne(p: Partial<LignePortions> & { id: number }): LignePortions {
  return {
    titre: "Chili",
    zone: "congelo",
    restantes: 2,
    rangeLe: midi("2026-08-01"),
    ...p,
  };
}

describe("ageEnJours", () => {
  it("compte des JOURS DE CALENDRIER, pas des tranches de 24 h", () => {
    // Rangé hier 23 h, regardé ce matin 7 h : une soustraction d'horodatages dirait
    // « 0 jour », alors que la réponse attendue devant le frigo est « hier ».
    const hier23h = new Date("2026-08-11T03:00:00Z"); // 10/08 23 h à Toronto
    const ceMatin7h = new Date("2026-08-11T11:00:00Z"); // 11/08 07 h à Toronto
    expect(ageEnJours(hier23h, ceMatin7h)).toBe(1);
  });

  it("date dans le fuseau de Marc, jamais en UTC", () => {
    // Vercel tourne en UTC (Toronto = UTC−4 en août). Ces deux instants sont le MÊME jour
    // local — 10/08 après-midi et 10/08 en soirée — mais tombent sur DEUX jours UTC
    // différents. Une datation en UTC annoncerait donc « hier » à une portion rangée le
    // soir même, quelques heures plus tôt.
    //
    // ⚠️ Ce test avait d'abord été écrit avec deux instants du même jour UTC : il passait
    // aussi bien en UTC qu'à Toronto, donc il ne verrouillait rien. C'est la mutation qui
    // l'a révélé, pas la relecture.
    const rangeApresMidi = new Date("2026-08-10T20:00:00Z"); // 10/08 16 h à Toronto
    const memeSoir = new Date("2026-08-11T02:00:00Z"); // 10/08 22 h à Toronto
    expect(ageEnJours(rangeApresMidi, memeSoir)).toBe(0);
  });

  it("compte les jours au-delà de la semaine", () => {
    expect(ageEnJours(midi("2026-08-01"), midi("2026-08-15"))).toBe(14);
  });
});

describe("formatAge", () => {
  it("nomme les cas proches plutôt que de compter", () => {
    expect(formatAge(0)).toBe("aujourd’hui");
    expect(formatAge(1)).toBe("hier");
    expect(formatAge(5)).toBe("il y a 5 jours");
  });

  it("passe aux semaines puis aux mois quand compter en jours ne dit plus rien", () => {
    expect(formatAge(21)).toBe("il y a 3 semaines");
    expect(formatAge(95)).toBe("il y a 3 mois");
  });

  it("ne rend jamais un âge négatif (horloge décalée)", () => {
    expect(formatAge(-3)).toBe("aujourd’hui");
  });
});

describe("passeLeRepere", () => {
  it("le frigo et le congélo n'ont pas le même repère", () => {
    // Un repère de conservation, pas un verdict sanitaire : il sert à faire REMONTER.
    expect(passeLeRepere("frigo", 4)).toBe(false);
    expect(passeLeRepere("frigo", 5)).toBe(true);
    expect(passeLeRepere("congelo", 5)).toBe(false);
    expect(passeLeRepere("congelo", 91)).toBe(true);
  });
});

describe("trierPortions", () => {
  it("met le FRIGO avant le congélo, puis le plus ancien en premier", () => {
    const triees = trierPortions([
      ligne({ id: 1, zone: "congelo", rangeLe: midi("2026-08-01") }),
      ligne({ id: 2, zone: "frigo", rangeLe: midi("2026-08-10") }),
      ligne({ id: 3, zone: "frigo", rangeLe: midi("2026-08-05") }),
      ligne({ id: 4, zone: "congelo", rangeLe: midi("2026-07-01") }),
    ]);
    // Le frigo se perd en jours, le congélo en mois : ce qui presse doit être en haut,
    // même quand une portion de congélo est bien plus vieille.
    expect(triees.map((l) => l.id)).toEqual([3, 2, 4, 1]);
  });

  it("départage deux portions du même jour de façon STABLE", () => {
    // Sans départage, deux lignes du même jour changeraient de place d'un rendu à l'autre.
    const meme = midi("2026-08-01");
    const a = trierPortions([
      ligne({ id: 9, titre: "Zucchini", rangeLe: meme }),
      ligne({ id: 4, titre: "Chili", rangeLe: meme }),
    ]);
    const b = trierPortions([
      ligne({ id: 4, titre: "Chili", rangeLe: meme }),
      ligne({ id: 9, titre: "Zucchini", rangeLe: meme }),
    ]);
    expect(a.map((l) => l.id)).toEqual(b.map((l) => l.id));
    expect(a.map((l) => l.id)).toEqual([4, 9]);
  });

  it("ne modifie pas le tableau reçu", () => {
    const source = [ligne({ id: 2, zone: "congelo" }), ligne({ id: 1, zone: "frigo" })];
    trierPortions(source);
    expect(source.map((l) => l.id)).toEqual([2, 1]);
  });
});

describe("compterPortions", () => {
  it("additionne les PORTIONS, pas les lignes", () => {
    // Trois lignes peuvent valoir douze repas : compter les lignes tromperait l'accueil.
    const { parZone, total } = compterPortions([
      ligne({ id: 1, zone: "frigo", restantes: 2 }),
      ligne({ id: 2, zone: "congelo", restantes: 6 }),
      ligne({ id: 3, zone: "congelo", restantes: 4 }),
    ]);
    expect(parZone).toEqual({ frigo: 2, congelo: 10 });
    expect(total).toBe(12);
  });

  it("rend zéro partout sur un stock vide", () => {
    expect(compterPortions([])).toEqual({ parZone: { frigo: 0, congelo: 0 }, total: 0 });
  });
});

describe("estZone", () => {
  it("refuse ce qui n'est pas une zone connue", () => {
    // La colonne est un `text` côté Postgres : la page écarte ce qui ne tient pas le
    // contrat plutôt que de ranger au hasard.
    expect(estZone("frigo")).toBe(true);
    expect(estZone("congelo")).toBe(true);
    expect(estZone("cellier")).toBe(false);
    expect(estZone(null)).toBe(false);
    expect(estZone(undefined)).toBe(false);
  });
});

describe("validerRangements", () => {
  const base = { recipeId: 1, titre: "Chili", zone: "congelo", portions: 6 };

  it("accepte un rangement normal", () => {
    const res = validerRangements([base]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rangements).toEqual([{ ...base, zone: "congelo" }]);
  });

  it("ÉCARTE les lignes à zéro sans les refuser", () => {
    // « Rien rangé pour cette recette » est légitime : tout mangé le soir même.
    const res = validerRangements([base, { ...base, recipeId: 2, titre: "Soupe", portions: 0 }]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rangements.map((r) => r.titre)).toEqual(["Chili"]);
  });

  it("refuse une saisie absurde EN NOMMANT la recette", () => {
    // Un message générique obligerait à relire toutes les lignes pour trouver la fautive.
    const res = validerRangements([base, { ...base, titre: "Soupe", portions: -2 }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.erreur).toContain("Soupe");
  });

  it("refuse un nombre non entier (une demi-portion n'est pas un repas)", () => {
    const res = validerRangements([{ ...base, portions: 2.5 }]);
    expect(res.ok).toBe(false);
  });

  it("refuse une zone hors contrat", () => {
    const res = validerRangements([{ ...base, zone: "cellier" }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.erreur).toContain("Chili");
  });

  it("refuse un rangement entièrement vide", () => {
    // Sinon on marquerait le batch « terminé » sans une seule portion, et l'app dirait
    // qu'il n'y a rien à manger alors que personne n'a rien déclaré.
    const res = validerRangements([{ ...base, portions: 0 }]);
    expect(res.ok).toBe(false);
  });

  it("retombe sur l'identifiant quand le titre est vide", () => {
    const res = validerRangements([{ ...base, titre: "   ", portions: -1 }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.erreur).toContain("recette 1");
  });
});
