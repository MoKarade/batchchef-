// Verrou de la normalisation de recherche (CAT-B).
//
// Le risque propre à ce lot n'est pas qu'une fonction soit fausse — c'est que les DEUX
// exemplaires de la règle (Postgres et TypeScript) divergent. Une divergence ne lève rien :
// elle fait disparaître des résultats, en silence. Ces tests protègent donc surtout
// l'UNICITÉ de la source.

import { describe, expect, it } from "vitest";
import {
  A_RETIRER,
  DEVELOPPEMENTS,
  EQUIVALENCES,
  expressionSql,
  normaliserPourRecherche,
} from "../lib/rechercheNormalisee";

describe("normaliserPourRecherche — ce que l'utilisateur tape doit trouver", () => {
  it("retire les accents, y compris DÉCOMPOSÉS", () => {
    expect(normaliserPourRecherche("Crème brûlée")).toBe("creme brulee");
    // Même mot, écrit en NFD : « a » suivi d'un accent combinant. Identique à l'œil, et le
    // corpus en porte 32. Mutation : retirer le `normalize("NFD")` fait tomber ce cas seul.
    expect(normaliserPourRecherche("Pâte")).toBe("pate");
    expect(normaliserPourRecherche("Pâte")).toBe(normaliserPourRecherche("Pâte"));
  });

  it("ramène l'apostrophe typographique à celle du clavier", () => {
    // 340 noms d'ingrédient et 240 titres portent `’`. Personne ne tape ce caractère.
    expect(normaliserPourRecherche("gousses d’ail")).toBe("gousses d'ail");
  });

  it("efface les marques déposées et les invisibles", () => {
    expect(normaliserPourRecherche("Kub® Or MAGGI®")).toBe("kub or maggi");
    expect(normaliserPourRecherche("HERTA®️")).toBe("herta");
    expect(normaliserPourRecherche("sel fin")).toBe("sel fin");
  });

  it("développe les ligatures en deux lettres", () => {
    // `translate` ne sait pas faire 1 → 2 : sans la passe `replace`, « œuf » deviendrait
    // « uf ». Mutation : vider DEVELOPPEMENTS fait tomber ce cas.
    expect(normaliserPourRecherche("Œufs à la neige")).toBe("oeufs a la neige");
    expect(normaliserPourRecherche("cœur de bœuf")).toBe("coeur de boeuf");
  });

  it("est IDEMPOTENTE — normaliser deux fois ne change rien", () => {
    for (const s of ["Crème brûlée", "Kub® Or MAGGI®", "Œufs à la neige", "  Pâté   en croûte "]) {
      expect(normaliserPourRecherche(normaliserPourRecherche(s))).toBe(normaliserPourRecherche(s));
    }
  });

  it("ne rend jamais une chaîne vide pour un texte qui porte des lettres", () => {
    // Un garde qui viderait le texte le rendrait introuvable — pire que le défaut d'origine.
    for (const s of ["Œuf", "Crème", "®Marque®", "Pâte"]) {
      expect(normaliserPourRecherche(s).length).toBeGreaterThan(0);
    }
  });
});

describe("l'expression SQL et le TypeScript ne peuvent pas diverger", () => {
  it("l'expression SQL est FABRIQUÉE depuis les mêmes constantes", () => {
    const sql = expressionSql("title");
    // Chaque développement, chaque équivalence et chaque caractère retiré doit s'y retrouver.
    for (const [de] of DEVELOPPEMENTS) expect(sql).toContain(de);
    expect(sql).toContain("normalize(");
    expect(sql).toContain("NFD");
    for (const [de] of EQUIVALENCES) {
      // Les invisibles sont échappés en \uXXXX, les autres apparaissent tels quels.
      const code = de.charCodeAt(0);
      const attendu = code === 0xa0 || code === 0x202f || code === 0x2009
        ? `\\u${code.toString(16).padStart(4, "0")}`
        : de === "'" ? "''" : de;
      expect(sql).toContain(attendu);
    }
    expect(A_RETIRER.length).toBeGreaterThan(10);
  });

  it("n'utilise QUE des fonctions immuables — une colonne générée refuse le reste", () => {
    // `unaccent` serait le réflexe : elle n'est PAS immuable (elle lit un dictionnaire), donc
    // Postgres refuse la colonne générée, et l'installer demande un privilège sur Neon.
    // Mutation : ajouter `unaccent(` à l'expression fait tomber ce test.
    const sql = expressionSql("title");
    expect(sql).not.toContain("unaccent");
    const appelees = [...sql.matchAll(/([a-z_]+)\s*\(/g)].map((m) => m[1]);
    const immuables = new Set(["btrim", "regexp_replace", "lower", "translate", "normalize", "replace"]);
    for (const f of appelees) expect(immuables.has(f!), `fonction non immuable : ${f}`).toBe(true);
  });

  it("cite la colonne demandée, et elle seule", () => {
    expect(expressionSql("title")).toContain("title");
    expect(expressionSql("name")).toContain("name");
    expect(expressionSql("title")).not.toContain("name");
  });
});
