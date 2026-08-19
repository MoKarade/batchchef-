// Réparation des noms d'ingrédients hérités du catalogue V3 (ING-03).
//
// Les cas ci-dessous ne sont pas inventés : ils viennent du corpus réel (10 188 recettes,
// 15 389 ingrédients), relevés en mesurant plutôt qu'en supposant. Le défaut lui-même a été
// trouvé en LISANT une vraie sortie du MCP, pas par un test — d'où ce fichier.

import { describe, expect, it } from "vitest";
import { estNomAbime, reparerCanonique, reparerNom } from "../lib/ingredientsNoms";

describe("détection du dégât", () => {
  it("reconnaît les trois formes relevées sur le corpus", () => {
    for (const n of [
      "À Soupe De Persil",
      "À Soupe D'Huile De Tournesol",
      "À Café De Paprika",
      "Ousses D'Ail",
      "Ousses De Vanille",
      "S De Sel",
      "S De Graines De Sésame",
    ]) {
      expect(estNomAbime(n), n).toBe(true);
    }
  });

  it("laisse tranquille ce qui est sain — c'est 13 000 entrées sur 15 389", () => {
    // Élargir la détection re-fragmenterait des regroupements qui marchent aujourd'hui.
    for (const n of [
      "Persil",
      "Gousses D'Ail",
      "Champignons De Paris",
      "Blancs De Poulet",
      "Crème Liquide",
      "Sel de mer fin",
      "Sauce Soja",
      "Tranches De Jambon",
      "Sucre",
      "Ail",
    ]) {
      expect(estNomAbime(n), n).toBe(false);
    }
  });

  it("ne se déclenche pas sur un mot qui COMMENCE comme un dégât", () => {
    // « Sardines » commence par « S » ; « Ousses » doit être le mot entier, pas un début.
    for (const n of ["Sardines", "Sucre De Canne", "Aubergine", "Oussesque", "Ail Des Ours"]) {
      expect(estNomAbime(n), n).toBe(false);
    }
  });
});

describe("réparation du nom", () => {
  it("retire l'unité mal bornée et rend l'ingrédient réel", () => {
    expect(reparerNom("À Soupe De Persil")).toBe("Persil");
    expect(reparerNom("À Soupe D'Huile De Tournesol")).toBe("Huile De Tournesol");
    expect(reparerNom("À Café De Paprika")).toBe("Paprika");
    expect(reparerNom("À Soupe De Jus De Citron")).toBe("Jus De Citron");
  });

  it("restitue la lettre mangée par la reconnaissance de « g » dans « gousses »", () => {
    expect(reparerNom("Ousses D'Ail")).toBe("Gousses D'Ail");
    expect(reparerNom("Ousses De Vanille")).toBe("Gousses De Vanille");
  });

  it("retire le « s » de pluriel resté seul après « pincée »", () => {
    expect(reparerNom("S De Sel")).toBe("Sel");
    expect(reparerNom("S De Graines De Sésame")).toBe("Graines De Sésame");
  });

  it("est IDEMPOTENTE : rejouer la passe ne change plus rien", () => {
    // C'est ce qui rend la réparation sûre à relancer à chaque déploiement.
    for (const n of ["À Soupe De Persil", "Ousses D'Ail", "S De Sel", "Persil"]) {
      const une = reparerNom(n);
      expect(reparerNom(une), n).toBe(une);
    }
  });

  it("ne rend JAMAIS une chaîne vide", () => {
    // Un nom vide sur une liste d'épicerie est pire que le nom abîmé : il ne dit plus
    // quoi acheter. En cas de retrait total, on garde l'original.
    for (const n of ["À Soupe De", "S De", "À Soupe"]) {
      expect(reparerNom(n), n).not.toBe("");
      expect(reparerNom(n).length, n).toBeGreaterThan(0);
    }
  });

  it("laisse un nom sain rigoureusement intact", () => {
    for (const n of ["Persil", "Gousses D'Ail", "Sel de mer fin", "Champignons De Paris"]) {
      expect(reparerNom(n), n).toBe(n);
    }
  });
});

describe("réparation de la clé de regroupement", () => {
  it("répare la clé comme le nom — sinon la fusion n'a pas lieu", () => {
    // C'est la clé qui décide si deux lignes fusionnent sur la liste d'épicerie ; réparer
    // le nom sans la clé donnerait deux lignes AU MÊME NOM, ce qui est pire qu'avant.
    expect(reparerCanonique("à_soupe_de_persil")).toBe("persil");
    expect(reparerCanonique("à_soupe_d'huile_de_tournesol")).toBe("huile_de_tournesol");
    expect(reparerCanonique("ousses_d'ail")).toBe("gousses_d'ail");
    expect(reparerCanonique("s_de_graines_de_sésame")).toBe("graines_de_sésame");
  });

  it("nom et clé réparés restent cohérents entre eux", () => {
    const cas: [string, string][] = [
      ["À Soupe De Persil", "à_soupe_de_persil"],
      ["Ousses D'Ail", "ousses_d'ail"],
      ["S De Sel", "s_de_sel"],
    ];
    for (const [nom, cle] of cas) {
      const n = reparerNom(nom).toLowerCase().replace(/ /g, "_");
      expect(reparerCanonique(cle), nom).toBe(n);
    }
  });

  it("laisse une clé saine intacte, et ne mord pas dans un mot", () => {
    for (const k of ["persil", "gousses_d'ail", "sucre", "sardines", "sel_de_mer"]) {
      expect(reparerCanonique(k), k).toBe(k);
    }
  });

  it("est idempotente elle aussi", () => {
    for (const k of ["à_soupe_de_persil", "ousses_d'ail", "s_de_sel"]) {
      const une = reparerCanonique(k);
      expect(reparerCanonique(une), k).toBe(une);
    }
  });
});
