// Liste d'épicerie regroupée par rayon, prête à commander (critères C1, C5, C6 de la spec).

import { describe, expect, it } from "vitest";
import { formatQty } from "../lib/aggregate";
import { RAYONS } from "../lib/rayons";
import {
  construireTexteParRayon,
  grouperParRayon,
  ligneArticle,
  type ArticleListe,
} from "../lib/listeParRayon";

const art = (
  name: string,
  canonical: string,
  qty: number | null,
  unit: ArticleListe["unit"],
  checked = false,
): ArticleListe => ({ name, canonical, qty, unit, checked });

const LISTE: ArticleListe[] = [
  art("Tomates", "tomates", 500, "g"),
  art("Lait", "lait", 2000, "ml"),
  art("Carottes", "carottes", 3, "unite"),
  art("Riz", "riz", 1000, "g"),
  art("Poulet", "blancs de poulet", 800, "g"),
  art("Sel", "sel", null, null),
  art("Beurre", "beurre", 250, "g", true),
];

describe("ligneArticle — une ligne par article, quantités brutes (C1)", () => {
  it("nom — quantité formatée comme partout ailleurs", () => {
    expect(ligneArticle({ name: "Poulet", qty: 500, unit: "g" })).toBe("Poulet — 500 g");
    expect(ligneArticle({ name: "Lait", qty: 2000, unit: "ml" })).toBe(`Lait — ${formatQty(2000, "ml")}`);
    expect(ligneArticle({ name: "Oignon", qty: 2, unit: "unite" })).toBe("Oignon — 2");
  });

  it("« au goût » (qty null) → le nom seul", () => {
    expect(ligneArticle({ name: "Sel", qty: null, unit: null })).toBe("Sel");
  });
});

describe("grouperParRayon (C5)", () => {
  it("groupes dans l'ordre de RAYONS, groupes vides omis", () => {
    const groupes = grouperParRayon(LISTE);
    const ordre = groupes.map((g) => RAYONS.indexOf(g.rayon));
    expect(ordre).toEqual([...ordre].sort((a, b) => a - b));
    expect(groupes.every((g) => g.articles.length > 0)).toBe(true);
    expect(groupes.map((g) => g.rayon)).toEqual([
      "Fruits et légumes",
      "Viandes et poissons",
      "Produits laitiers et œufs",
      "Épicerie",
    ]);
  });

  it("articles triés alphabétiquement (fr) dans un rayon", () => {
    const groupes = grouperParRayon([
      art("Tomates", "tomates", 1, "unite"),
      art("Échalotes", "échalotes", 2, "unite"),
      art("carottes", "carottes", 3, "unite"),
    ]);
    expect(groupes[0]?.articles.map((a) => a.name)).toEqual(["carottes", "Échalotes", "Tomates"]);
  });

  it("n'exporte que le RESTANT (articles cochés = déjà au panier)", () => {
    const noms = grouperParRayon(LISTE).flatMap((g) => g.articles.map((a) => a.name));
    expect(noms).not.toContain("Beurre");
    expect(noms).toHaveLength(6);
  });

  it("tout coché → toute la liste (même repli que le partage Keep)", () => {
    const tout = LISTE.map((a) => ({ ...a, checked: true }));
    expect(grouperParRayon(tout).flatMap((g) => g.articles)).toHaveLength(LISTE.length);
  });

  it("liste vide → aucun groupe", () => {
    expect(grouperParRayon([])).toEqual([]);
  });

  it("ne modifie pas la liste reçue", () => {
    const copie = LISTE.map((a) => ({ ...a }));
    grouperParRayon(LISTE);
    expect(LISTE).toEqual(copie);
  });
});

describe("grouperParRayon — rien n'est perdu (C6)", () => {
  it("un nom vide, « ingrédient » ou le canonical « es » apparaît quand même, dans Autres", () => {
    const douteux = [
      art("", "", 1, "unite"),
      art("ingrédient", "ingredient", 100, "g"),
      art("es", "es", null, null),
    ];
    const groupes = grouperParRayon([...LISTE, ...douteux]);
    const autres = groupes.find((g) => g.rayon === "Autres");
    expect(autres?.articles.map((a) => a.name).sort()).toEqual(["", "es", "ingrédient"]);
  });

  it("propriété : le multiset des noms restants est conservé", () => {
    const entree = [
      ...LISTE,
      art("Tomates", "tomates", 200, "ml"), // même nom, autre unité : deux lignes
      art("Xyzzy", "xyzzy", 1, "unite"),
    ];
    const attendus = entree.filter((a) => !a.checked).map((a) => a.name).sort();
    const sortis = grouperParRayon(entree).flatMap((g) => g.articles.map((a) => a.name)).sort();
    expect(sortis).toEqual(attendus);
  });
});

describe("construireTexteParRayon", () => {
  it("titre séparé ; corps = en-têtes de rayon et lignes d'articles, un rayon par paragraphe", () => {
    const out = construireTexteParRayon("Semaine 1", LISTE);
    expect(out?.title).toBe("Épicerie par rayon — Semaine 1");
    expect(out?.body).toBe(
      [
        "Fruits et légumes :",
        "Carottes — 3",
        "Tomates — 500 g",
        "",
        "Viandes et poissons :",
        "Poulet — 800 g",
        "",
        "Produits laitiers et œufs :",
        `Lait — ${formatQty(2000, "ml")}`,
        "",
        "Épicerie :",
        "Riz — 1 kg",
        "Sel",
      ].join("\n"),
    );
  });

  it("chaque ligne d'article est EXACTEMENT ligneArticle (C1) ; ni prix ni format inventé", () => {
    const out = construireTexteParRayon("B", LISTE);
    const lignes = (out?.body ?? "").split("\n").filter((l) => l !== "" && !l.endsWith(" :"));
    const attendues = LISTE.filter((a) => !a.checked).map(ligneArticle).sort();
    expect([...lignes].sort()).toEqual(attendues);
    expect(out?.body).not.toMatch(/\$/);
    expect(out?.body).not.toMatch(/\b(paquet|boîte|sac|format)\b/i);
  });

  it("liste vide → null (rien à copier)", () => {
    expect(construireTexteParRayon("B", [])).toBeNull();
  });
});
