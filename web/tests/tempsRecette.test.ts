// Verrou des durées de recette (CAT-C).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dureesAffichables, formatDuree, tempsCorrige } from "../lib/tempsRecette";
import { getTableColumns } from "drizzle-orm";
import { schema } from "../lib/db";

describe("tempsCorrige — des minutes lues comme des heures", () => {
  it("ramène une durée aberrante MULTIPLE DE 60 à sa valeur en minutes", () => {
    // « Funky Pop Corn » annonçait 1 800 min de préparation, soit trente heures.
    expect(tempsCorrige(1800)).toBe(30);
    expect(tempsCorrige(2700)).toBe(45);
    expect(tempsCorrige(1200)).toBe(20);
  });

  it("NE TOUCHE PAS une durée aberrante qui n'est pas un multiple de 60", () => {
    // 1 451, 870, 1 830 : les quatre valeurs du corpus qu'aucune règle n'explique. Une
    // marinade de 24 h existe ; inventer une correction serait pire que la laisser.
    // Mutation : retirer la condition `% 60 === 0` fait tomber ce test.
    expect(tempsCorrige(1451)).toBe(1451);
    expect(tempsCorrige(870)).toBe(870);
  });

  it("laisse intacte une durée plausible, même multiple de 60", () => {
    // 3,8 % des durées plausibles sont des multiples de 60 : sans le seuil, on diviserait
    // une heure de cuisson par soixante. Mutation : supprimer le seuil fait tomber ce test.
    expect(tempsCorrige(60)).toBe(60);
    expect(tempsCorrige(120)).toBe(120);
    expect(tempsCorrige(720)).toBe(720);
  });

  it("rend null sur une absence, jamais zéro", () => {
    expect(tempsCorrige(null)).toBeNull();
    expect(tempsCorrige(undefined)).toBeNull();
  });
});

describe("formatDuree", () => {
  it("écrit en heures dès que ça dépasse l'heure", () => {
    expect(formatDuree(45)).toBe("45 min");
    expect(formatDuree(60)).toBe("1 h");
    expect(formatDuree(85)).toBe("1 h 25");
  });

  it("ne rend rien pour zéro — zéro minute n'est pas une durée", () => {
    expect(formatDuree(0)).toBeNull();
    expect(formatDuree(null)).toBeNull();
  });
});

describe("dureesAffichables — l'absence de donnée ne s'affiche pas", () => {
  it("les DEUX à zéro : rien du tout", () => {
    // 224 recettes du catalogue, dont « Gâteau à la vapeur au chocolat ». Un « 0 min »
    // affirmerait qu'elles se font toutes seules.
    // ⚠️ Ce cas est protégé DEUX FOIS : `formatDuree` refuse zéro, et `dureesAffichables`
    // s'arrête avant lui. Retirer l'un des deux seul ne change rien — je l'ai mesuré, et
    // ma première mutation était vide pour cette raison. La mutation qui discrimine
    // vraiment est de faire tomber les DEUX : dès que `formatDuree` accepte zéro, ce test
    // ne passe plus QUE grâce au garde, et le retirer aussi le fait tomber.
    expect(dureesAffichables(0, 0)).toEqual({ preparation: null, cuisson: null, total: null });
    expect(dureesAffichables(null, null).total).toBeNull();
  });

  it("une cuisson à zéro SEULE reste crédible : on affiche la préparation et le total", () => {
    const d = dureesAffichables(20, 0);
    expect(d.preparation).toBe("20 min");
    expect(d.cuisson).toBeNull();
    expect(d.total).toBe("20 min");
  });

  it("le total additionne, et corrige avant d'additionner", () => {
    expect(dureesAffichables(20, 40).total).toBe("1 h");
    // 1 800 = 30 h dans la source : sans la correction, le total serait absurde.
    expect(dureesAffichables(1800, 10).total).toBe("40 min");
  });
});

describe("la copie catalogue → bibliothèque n'oublie aucune colonne", () => {
  it("recopie TOUTES les colonnes que les deux tables partagent", () => {
    // ⚠️ Le garde DÉRIVE la liste du schéma au lieu de la réécrire : une liste recopiée
    // vieillit comme celles qu'elle remplace. C'est le défaut qui a fait entrer quarante
    // offres sans ville en production chez JobAI — le type portait le champ, la lecture le
    // lisait, l'écriture le perdait, et rien ne levait.
    // Mutation : retirer `prepMinutes` de l'insert de `ajouterDuCatalogueInterne` fait
    // tomber ce test.
    const code = readFileSync(resolve(process.cwd(), "lib/actions.ts"), "utf8");
    const bloc = code.slice(code.indexOf("ajouterDuCatalogueInterne"));
    const insert = bloc.slice(bloc.indexOf(".insert(schema.recipes)"), bloc.indexOf(".returning"));

    // `getTableColumns` plutôt que `Object.keys` : l'objet de table porte aussi des
    // méthodes de Drizzle (`enableRLS`), qu'une liste naïve prendrait pour des colonnes.
    const colonnesCatalogue = new Set(Object.keys(getTableColumns(schema.catalogRecipes)));
    const propres = new Set(["id", "sourceUrl", "titreRecherche"]); // identité et colonne générée
    const aRecopier = Object.keys(getTableColumns(schema.recipes)).filter(
      (c) => colonnesCatalogue.has(c) && !propres.has(c),
    );

    expect(aRecopier.length).toBeGreaterThan(3);
    for (const colonne of aRecopier) {
      expect(insert, `colonne perdue à la copie : ${colonne}`).toContain(`${colonne}:`);
    }
  });
});
