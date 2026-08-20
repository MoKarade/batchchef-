// Verrou du ménage de texte (CAT-D).

import { describe, expect, it } from "vitest";
import { aBesoinDeMenage, nettoyerTexte } from "../lib/menageTexte";

describe("nettoyerTexte — ce qui s'affiche", () => {
  it("décode les entités HTML vues dans le corpus", () => {
    expect(nettoyerTexte("Poireaux gratiné façon &quot;pizza&quot;")).toBe('Poireaux gratiné façon "pizza"');
    expect(nettoyerTexte("des morceaux de M&amp;M’s")).toBe("des morceaux de M&M’s");
  });

  it("décode `&amp;` EN DERNIER — sinon double décodage", () => {
    // `&amp;quot;` est un texte qui dit littéralement `&quot;`. Décoder `&amp;` d'abord en
    // ferait un guillemet, c'est-à-dire autre chose que ce que la source écrit.
    // Mutation : remonter `&amp;` en tête de la liste fait tomber ce test.
    expect(nettoyerTexte("littéralement &amp;quot;")).toBe("littéralement &quot;");
  });

  it("recompose les accents décomposés (NFD → NFC)", () => {
    const decompose = "Pâte";
    expect(decompose).not.toBe("Pâte");
    expect(nettoyerTexte(decompose)).toBe("Pâte");
  });

  it("retire les invisibles", () => {
    // 149 sélecteurs de variante dans le corpus, hérités des noms de marque.
    expect(nettoyerTexte("HERTA®️")).toBe("HERTA®");
    expect(nettoyerTexte("a​b")).toBe("ab");
  });

  it("réduit les espaces DOUBLES et coupe aux bords", () => {
    expect(nettoyerTexte("persil et  sauce")).toBe("persil et sauce");
    expect(nettoyerTexte("  Houmous de  betterave ")).toBe("Houmous de betterave");
  });

  it("CONSERVE l'espace insécable — c'est de la typographie juste, pas un défaut", () => {
    // 325 dans le corpus. En français il est CORRECT devant « ; : ! ? ». Le remplacer
    // abîmerait un texte juste.
    // Mutation : ajouter l'insécable à la réduction d'espaces fait tomber ce test.
    expect(nettoyerTexte("Attention : mélanger")).toBe("Attention : mélanger");
    expect(nettoyerTexte("« pizza »")).toBe("« pizza »");
  });

  it("ne touche pas à un texte déjà propre", () => {
    const propre = "Fusilli à la crème champignons et poulet";
    expect(nettoyerTexte(propre)).toBe(propre);
    expect(aBesoinDeMenage(propre)).toBe(false);
    expect(aBesoinDeMenage("persil et  sauce")).toBe(true);
  });

  it("préserve la structure en paragraphes des instructions", () => {
    // Les instructions sont séparées par des sauts de ligne simples chez 1 974 recettes
    // sur les 2 000 examinées : les écraser rendrait chaque recette illisible.
    // Mutation : réduire `\n` comme une espace fait tomber ce test.
    expect(nettoyerTexte("Étape une.\nÉtape deux.\nÉtape trois.")).toBe(
      "Étape une.\nÉtape deux.\nÉtape trois.",
    );
  });
});
