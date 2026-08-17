// Garde-manger : ce qui quitte la liste principale, et ce qui n'en sort JAMAIS.
//
// Ces tests gardent une promesse produit, pas une mise en page : un article déclaré « j'ai
// toujours ça » est DÉPLACÉ, jamais supprimé. Une erreur ici ne se voit pas à l'écran — elle
// se découvre au retour du magasin, sans l'huile.

import { describe, expect, it } from "vitest";
import {
  cleGardeManger,
  separerGardeManger,
  validerAjoutGardeManger,
} from "../lib/gardeManger";

const article = (canonical: string) => ({ canonical, nom: canonical });

describe("cleGardeManger", () => {
  it("ignore accents, casse et espaces en trop", () => {
    // Le garde-manger se remplit depuis ce que Marc voit à l'écran : dépendre d'une égalité
    // d'octets ferait rater « Crème fraîche » contre « creme fraiche ».
    expect(cleGardeManger("Crème  Fraîche")).toBe(cleGardeManger("creme fraiche"));
    expect(cleGardeManger("  HUILE  ")).toBe("huile");
  });

  it("rend une chaîne vide pour une entrée vide", () => {
    expect(cleGardeManger("   ")).toBe("");
  });
});

describe("separerGardeManger", () => {
  it("déplace les articles du placard sans les perdre", () => {
    const liste = [article("sel"), article("poulet"), article("huile")];
    const { aAcheter, auPlacard } = separerGardeManger(liste, ["sel", "huile"]);

    expect(aAcheter.map((a) => a.canonical)).toEqual(["poulet"]);
    expect(auPlacard.map((a) => a.canonical)).toEqual(["sel", "huile"]);
    // LA garantie : rien ne disparaît. Les deux paquets recomposent la liste d'origine.
    expect(aAcheter.length + auPlacard.length).toBe(liste.length);
  });

  it("n'apparie que sur la clé EXACTE, jamais par sous-chaîne", () => {
    // « huile » ne doit pas emporter « huile de truffe », ni « lait » emporter « lait de
    // coco » : une heuristique floue peut grouper ce qu'on REGARDE, jamais décider ce qui
    // sort d'une liste de courses.
    const liste = [article("huile de truffe"), article("lait de coco"), article("lait")];
    const { aAcheter, auPlacard } = separerGardeManger(liste, ["huile", "lait"]);

    expect(aAcheter.map((a) => a.canonical)).toEqual(["huile de truffe", "lait de coco"]);
    expect(auPlacard.map((a) => a.canonical)).toEqual(["lait"]);
  });

  it("apparie malgré les accents et la casse des deux côtés", () => {
    const { auPlacard } = separerGardeManger([article("Crème Fraîche")], ["creme fraiche"]);
    expect(auPlacard).toHaveLength(1);
  });

  it("garde-manger vide : tout reste à acheter (l'état de départ voulu par Marc)", () => {
    const liste = [article("sel"), article("poulet")];
    const { aAcheter, auPlacard } = separerGardeManger(liste, []);
    expect(aAcheter).toHaveLength(2);
    expect(auPlacard).toHaveLength(0);
  });

  it("préserve l'ordre reçu dans chaque paquet", () => {
    // La liste arrive triée par nom : la re-trier autrement désorienterait en magasin.
    const liste = [article("ail"), article("beurre"), article("carotte"), article("dinde")];
    const { aAcheter, auPlacard } = separerGardeManger(liste, ["beurre", "ail"]);
    expect(auPlacard.map((a) => a.canonical)).toEqual(["ail", "beurre"]);
    expect(aAcheter.map((a) => a.canonical)).toEqual(["carotte", "dinde"]);
  });

  it("ne modifie pas la liste reçue", () => {
    const liste = [article("sel"), article("poulet")];
    separerGardeManger(liste, ["sel"]);
    expect(liste.map((a) => a.canonical)).toEqual(["sel", "poulet"]);
  });
});

describe("validerAjoutGardeManger", () => {
  it("normalise la clé et garde le nom lisible", () => {
    const res = validerAjoutGardeManger("Huile d’olive", "Huile d’Olive");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.cle).toBe("huile d’olive");
      expect(res.nom).toBe("Huile d’olive");
    }
  });

  it("refuse une clé vide", () => {
    // Une clé vide apparierait tout article sans canonical et viderait la moitié de la liste.
    const res = validerAjoutGardeManger("Sel", "   ");
    expect(res.ok).toBe(false);
  });

  it("retombe sur la clé quand le nom affiché manque", () => {
    const res = validerAjoutGardeManger("  ", "sel");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.nom).toBe("sel");
  });
});
