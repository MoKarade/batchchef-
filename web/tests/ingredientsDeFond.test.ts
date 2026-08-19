// Ce qui sort d'une liste d'épicerie sans qu'on le demande — et ce qui ne DOIT pas en sortir.
//
// Une erreur ici ne se voit pas à l'écran : elle se découvre en cuisinant, sans ses poivrons.
// D'où le soin mis aux cas-pièges plutôt qu'aux cas nominaux.

import { describe, expect, it } from "vitest";
import {
  ecarterIngredientsDeFond,
  estIngredientDeFond,
  resumerIngredientsDeFond,
} from "../lib/ingredientsDeFond";

describe("estIngredientDeFond", () => {
  it("reconnaît le sel et le poivre sous leurs formes courantes", () => {
    for (const c of ["sel", "gros sel", "fleur de sel", "sel de mer", "poivre", "poivre noir", "sel et poivre"]) {
      expect(estIngredientDeFond(c), c).toBe(true);
    }
  });

  it("ne se déclenche PAS sur les mots qui ressemblent", () => {
    // Le piège du projet, déjà payé avec « huile » qui emportait « huile de truffe » :
    // une correspondance par sous-chaîne exclurait les poivrons et le persil de la liste.
    for (const c of ["poivron", "poivron rouge", "poivrons farcis", "persil", "persil frisé", "selle d'agneau"]) {
      expect(estIngredientDeFond(c), c).toBe(false);
    }
  });

  it("écarte l'eau, mais SEULEMENT quand c'est de l'eau", () => {
    expect(estIngredientDeFond("eau")).toBe(true);
    expect(estIngredientDeFond("eau froide")).toBe(true);
    expect(estIngredientDeFond("eau bouillante")).toBe(true);
    // Ceux-là s'achètent : « eau » ne peut donc pas être un simple mot-clé.
    expect(estIngredientDeFond("eau de fleur d'oranger")).toBe(false);
    expect(estIngredientDeFond("eau de rose")).toBe(false);
    expect(estIngredientDeFond("eau gazeuse")).toBe(false);
  });

  it("laisse passer tout ce qui s'achète vraiment", () => {
    for (const c of ["huile d'olive", "farine", "sucre", "beurre", "poulet", "cassonade"]) {
      expect(estIngredientDeFond(c), c).toBe(false);
    }
  });

  it("ignore accents et casse", () => {
    expect(estIngredientDeFond("SEL")).toBe(true);
    expect(estIngredientDeFond("Eau Tiède")).toBe(true);
  });

  it("ne casse pas sur une entrée vide", () => {
    expect(estIngredientDeFond("")).toBe(false);
    expect(estIngredientDeFond("   ")).toBe(false);
  });
});

describe("ecarterIngredientsDeFond", () => {
  const a = (canonical: string) => ({ name: canonical, canonical });

  it("sépare sans rien perdre", () => {
    const liste = [a("sel"), a("poulet"), a("poivre"), a("poivron")];
    const { aAcheter, deFond } = ecarterIngredientsDeFond(liste);
    expect(aAcheter.map((x) => x.canonical)).toEqual(["poulet", "poivron"]);
    expect(deFond.map((x) => x.canonical)).toEqual(["sel", "poivre"]);
    // Rien ne s'évapore : les deux paquets recomposent la liste.
    expect(aAcheter.length + deFond.length).toBe(liste.length);
  });

  it("préserve l'ordre reçu", () => {
    const { aAcheter } = ecarterIngredientsDeFond([a("ail"), a("sel"), a("basilic")]);
    expect(aAcheter.map((x) => x.canonical)).toEqual(["ail", "basilic"]);
  });
});

describe("resumerIngredientsDeFond", () => {
  it("NOMME les ingrédients écartés", () => {
    // « 3 ingrédients non listés » ne se vérifie pas : impossible de repérer le jour où
    // quelque chose est écarté à tort.
    const phrase = resumerIngredientsDeFond(["Sel", "Poivre", "Eau"]);
    expect(phrase).toContain("Sel");
    expect(phrase).toContain("Poivre");
    expect(phrase).toContain("Eau");
  });

  it("accorde le singulier", () => {
    expect(resumerIngredientsDeFond(["Sel"])).toContain("n’est pas listé");
    expect(resumerIngredientsDeFond(["Sel", "Poivre"])).toContain("ne sont pas listés");
  });

  it("dédoublonne et trie", () => {
    expect(resumerIngredientsDeFond(["Sel", "sel ", "Poivre"])).toBe(
      resumerIngredientsDeFond(["Poivre", "Sel", "sel"]),
    );
  });

  it("se TAIT quand il n'y a rien à dire", () => {
    // Un bandeau permanent « 0 ingrédient écarté » devient du bruit qu'on cesse de lire.
    expect(resumerIngredientsDeFond([])).toBeNull();
    expect(resumerIngredientsDeFond(["", "  "])).toBeNull();
  });
});
