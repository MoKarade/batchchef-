// tests/assistantAtelier.test.ts — la réponse de l'assistant dans l'atelier de LIA (#346) : marqueurs → blocs, blocs validés,
// discussions de la page. Fonctions pures : rien ne touche la base ni le modèle.

import { describe, expect, it } from "vitest";
import { blocsValides, cleRecette, versReponseAtelier } from "../lib/assistant/atelier";
import { creerDiscussions, historiqueEnvoye, titreDe } from "../lib/assistant/discussions";

const titres = new Map([
  [cleRecette("catalogue", 482), "Poulet au riz"],
  [cleRecette("mes-recettes", 7), "Chili maison"],
]);

describe("versReponseAtelier", () => {
  it("retire les marqueurs du texte et rend un bloc par recette citée, avec son titre", () => {
    const { text, blocks } = versReponseAtelier(
      "Essaie le poulet au riz [catalogue #482] ou ton chili [mes-recettes #7].",
      titres,
    );
    expect(text).toBe("Essaie le poulet au riz ou ton chili .");
    expect(blocks).toEqual([
      { type: "recette", source: "catalogue", id: 482, titre: "Poulet au riz" },
      { type: "recette", source: "mes-recettes", id: 7, titre: "Chili maison" },
    ]);
    expect(text).not.toMatch(/\[|#482/);
  });

  it("⚠️ une recette inconnue de la base ne donne AUCUN bouton (le modèle a pu inventer le numéro)", () => {
    const { text, blocks } = versReponseAtelier("Voir [catalogue #999999] pour une idée.", titres);
    expect(blocks).toEqual([]);
    expect(text).toBe("Voir pour une idée.");
  });

  it("dédoublonne : une recette citée deux fois n'a qu'un bouton", () => {
    const { blocks } = versReponseAtelier("[catalogue #482] puis encore [catalogue #482]", titres);
    expect(blocks).toHaveLength(1);
  });

  it("un remplacement proposé devient une carte, une par place, même sans titre connu (la carte DIT l'erreur)", () => {
    const { text, blocks } = versReponseAtelier(
      "Je propose [semaine 3 ← catalogue #482] et aussi [semaine 3 <- catalogue #12].",
      titres,
    );
    expect(blocks).toEqual([{ type: "placement", place: 3, id: 482 }]);
    expect(text).not.toContain("semaine");
  });

  it("une place hors de la semaine reste du texte brut, sans carte", () => {
    const { text, blocks } = versReponseAtelier("Pour [semaine 9 ← catalogue #482] ?", titres);
    expect(blocks).toEqual([]);
    expect(text).toContain("[semaine 9");
  });

  it("garde le texte autour mot pour mot (sauts de ligne compris) et soigne les espaces laissés", () => {
    const { text } = versReponseAtelier("- Poulet au riz [catalogue #482]\n- Chili [mes-recettes #7]\n\nBon appétit.", titres);
    expect(text).toBe("- Poulet au riz\n- Chili\n\nBon appétit.");
  });

  it("une réponse faite des seuls marqueurs reste lisible ; sans marqueur ni bloc, le texte est intact", () => {
    expect(versReponseAtelier("[catalogue #482]", titres).text).toBe("Voici ce que j'ai trouvé dans ta base.");
    expect(versReponseAtelier("Rien de tel dans ta base.", titres)).toEqual({ text: "Rien de tel dans ta base.", blocks: [] });
  });
});

describe("blocsValides", () => {
  it("garde les deux formes connues et écarte le reste sans rien deviner", () => {
    const valides = blocsValides([
      { type: "recette", source: "catalogue", id: 1, titre: "A" },
      { type: "placement", place: 2, id: 3 },
      { type: "recette", source: "ailleurs", id: 1, titre: "A" }, // source inconnue
      { type: "recette", source: "catalogue", id: -1, titre: "A" }, // id invalide
      { type: "courbe", points: [1, 2] }, // forme inconnue
      "texte",
      null,
    ]);
    expect(valides).toEqual([
      { type: "recette", source: "catalogue", id: 1, titre: "A" },
      { type: "placement", place: 2, id: 3 },
    ]);
  });
});

describe("discussions de la page", () => {
  const ids = () => {
    let n = 0;
    return () => `d${++n}`;
  };

  it("commence vide, note les échanges, et titre la discussion par sa première question", () => {
    const d = creerDiscussions(ids());
    expect(d.courante()).toEqual([]);
    expect(d.liste()).toEqual([]);
    d.noter("Que faire avec du poulet ?", "Un poulet au riz.");
    d.noter("Et sans riz ?", "Des pâtes.");
    expect(d.courante()).toEqual([
      { role: "user", contenu: "Que faire avec du poulet ?" },
      { role: "assistant", contenu: "Un poulet au riz." },
      { role: "user", contenu: "Et sans riz ?" },
      { role: "assistant", contenu: "Des pâtes." },
    ]);
    expect(d.liste()).toEqual([{ id: "d1", titre: "Que faire avec du poulet ?" }]);
  });

  it("« nouveau » repart de zéro et garde l'ancienne ; « ouvrir » la rend (moi / lia) et la reprend comme courante", () => {
    const d = creerDiscussions(ids());
    d.noter("première", "r1");
    d.nouveau();
    expect(d.courante()).toEqual([]);
    d.noter("seconde", "r2");
    expect(d.liste().map((x) => x.titre)).toEqual(["seconde", "première"]);
    expect(d.ouvrir("d1")).toEqual([
      { de: "moi", texte: "première" },
      { de: "lia", texte: "r1" },
    ]);
    expect(d.courante()).toHaveLength(2);
    d.noter("suite", "r3");
    expect(d.ouvrir("d1")).toHaveLength(4); // la suite s'ajoute à la discussion rouverte
    expect(d.ouvrir("d2")).toHaveLength(2); // l'autre n'a pas bougé
  });

  it("une discussion inconnue ne rend rien et ne change pas la courante", () => {
    const d = creerDiscussions(ids());
    d.noter("q", "r");
    expect(d.ouvrir("nulle-part")).toEqual([]);
    expect(d.courante()).toHaveLength(2);
  });

  it("titreDe coupe les longues questions ; l'historique envoyé est borné", () => {
    expect(titreDe("a".repeat(100))).toHaveLength(60);
    expect(titreDe("  \n ")).toBe("Discussion");
    const longue = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), contenu: `m${i}` }));
    expect(historiqueEnvoye(longue)).toHaveLength(20);
    expect(historiqueEnvoye(longue).at(-1)).toEqual(longue.at(-1));
  });
});
