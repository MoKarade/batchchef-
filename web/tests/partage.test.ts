// Partage Android (Web Share Target) : démêlage des champs reçus, et verrous sur les trois
// fichiers qui doivent rester d'accord (manifeste, service worker, code applicatif).

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  CACHE_PARTAGE,
  CLE_META,
  CLE_VIDEO,
  normaliserPartage,
} from "../lib/partage";

function lire(chemin: string): string {
  return readFileSync(resolve(process.cwd(), chemin), "utf8");
}

/**
 * Fichiers RÉELLEMENT suivis par git sous un chemin donné.
 *
 * Vécu le 2026-08-12 : `.gitignore` héritait de Gatsby une règle `public`, qui chez Next
 * exclut des fichiers SOURCE. Le manifeste, le service worker et les icônes existaient sur
 * le disque — gate local vert — sans jamais entrer dans le dépôt : la fonctionnalité aurait
 * été mergée puis absente de la production, sans une seule erreur. Un garde qui regarde le
 * disque ne voit pas ça ; celui-ci regarde ce que git emporte.
 *
 * Échoue si git est indisponible : « je ne peux pas vérifier » n'est pas « c'est bon ».
 */
function fichiersSuivisParGit(prefixe: string): string[] {
  const sortie = execFileSync("git", ["ls-files", "--", prefixe], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return sortie.split("\n").filter(Boolean);
}

describe("normaliserPartage", () => {
  it("utilise le champ `url` quand l'app source le remplit", () => {
    expect(
      normaliserPartage({ url: "https://www.instagram.com/reel/ABC/", texte: "Poulet au miel" }),
    ).toEqual({ lien: "https://www.instagram.com/reel/ABC/", description: "Poulet au miel" });
  });

  it("sort l'URL du texte quand Android met tout dans `text` (cas Instagram)", () => {
    // Sans ça, l'URL partirait au LLM comme si elle faisait partie de la recette.
    expect(
      normaliserPartage({ texte: "Regarde ça https://www.instagram.com/reel/ABC/ trop bon" }),
    ).toEqual({ lien: "https://www.instagram.com/reel/ABC/", description: "Regarde ça  trop bon" });
  });

  it("un partage réduit à l'URL seule ne laisse aucune description", () => {
    expect(normaliserPartage({ texte: "https://www.instagram.com/reel/ABC/" })).toEqual({
      lien: "https://www.instagram.com/reel/ABC/",
      description: "",
    });
  });

  it("sans lien, TOUT le texte est gardé comme description (c'est peut-être la recette)", () => {
    const texte = "500 g de poulet\n2 c. à soupe de miel";
    expect(normaliserPartage({ texte })).toEqual({ lien: null, description: texte });
  });

  it("ne retient qu'un lien http(s) — même garde que côté serveur", () => {
    expect(normaliserPartage({ url: "javascript:alert(1)" }).lien).toBeNull();
    expect(normaliserPartage({ url: "ftp://exemple.com/x" }).lien).toBeNull();
  });

  it("n'empile pas un titre qui répète déjà le texte", () => {
    expect(normaliserPartage({ titre: "Poulet", texte: "Poulet au miel" }).description).toBe(
      "Poulet au miel",
    );
    expect(normaliserPartage({ titre: "Poulet", texte: "500 g" }).description).toBe("Poulet\n500 g");
  });

  it("un partage vide reste vide (jamais de contenu inventé)", () => {
    expect(normaliserPartage({})).toEqual({ lien: null, description: "" });
  });
});

describe("verrous entre le service worker et le code applicatif", () => {
  // Un service worker est un fichier statique : il ne peut rien importer de `lib/`. Les
  // clés de cache y sont donc DUPLIQUÉES, et une divergence casserait le partage en
  // silence — la page ne trouverait rien à lire. Ce test est ce qui l'interdit.
  const sw = lire("public/sw.js");

  it("le worker utilise exactement les clés de cache de lib/partage.ts", () => {
    expect(sw).toContain(`"${CACHE_PARTAGE}"`);
    expect(sw).toContain(`"${CLE_VIDEO}"`);
    expect(sw).toContain(`"${CLE_META}"`);
  });

  it("le worker ne met en cache QUE le partage (aucun cache hors-ligne de pages privées)", () => {
    // BatchChef affiche des données personnelles derrière une session : un cache de
    // réponses les laisserait sur l'appareil et servirait des écrans périmés.
    const misesEnCache = sw.match(/cache\.put\(/g) ?? [];
    expect(misesEnCache.length).toBe(2); // la vidéo et ses métadonnées, rien d'autre
    expect(sw).not.toContain("addAll");
  });
});

describe("verrous du manifeste PWA", () => {
  const manifeste = JSON.parse(lire("public/manifest.webmanifest")) as {
    icons?: { src: string }[];
    share_target?: {
      action?: string;
      method?: string;
      enctype?: string;
      params?: { files?: { name: string; accept: string[] }[] };
    };
  };

  it("déclare une cible de partage POST multipart acceptant une vidéo", () => {
    // Sans method POST + multipart, Android ne transmet AUCUN fichier : le partage se
    // réduirait à une URL, et l'app n'aurait rien à analyser.
    expect(manifeste.share_target?.method).toBe("POST");
    expect(manifeste.share_target?.enctype).toBe("multipart/form-data");
    const champ = manifeste.share_target?.params?.files?.[0];
    expect(champ?.name).toBe("video");
    expect(champ?.accept).toContain("video/*");
  });

  it("la page visée par le partage existe vraiment", () => {
    // Renommer la page sans toucher au manifeste enverrait chaque partage sur un 404.
    expect(manifeste.share_target?.action).toBe("/partage");
    expect(existsSync(resolve(process.cwd(), "app/partage/page.tsx"))).toBe(true);
  });

  it("les icônes déclarées existent sur le disque", () => {
    // Une icône manquante rend la PWA non installable — donc pas de partage du tout.
    const icones = manifeste.icons ?? [];
    expect(icones.length).toBeGreaterThan(0);
    for (const icone of icones) {
      expect(
        existsSync(resolve(process.cwd(), "public", icone.src.replace(/^\//, ""))),
        `icône ${icone.src} absente de public/`,
      ).toBe(true);
    }
  });
});

describe("les assets PWA sont VERSIONNÉS, pas seulement présents", () => {
  // Le vrai risque n'est pas qu'un fichier manque sur ma machine : c'est qu'il y soit et
  // n'entre jamais dans le dépôt. Un `.gitignore` trop large suffit, et rien ne le signale.
  const suivis = fichiersSuivisParGit("public");

  it("git suit le manifeste, le service worker et les icônes", () => {
    for (const attendu of [
      "public/manifest.webmanifest",
      "public/sw.js",
      "public/icone-192.png",
      "public/icone-512.png",
    ]) {
      expect(
        suivis,
        `${attendu} n'est pas suivi par git — il ne sera pas déployé, et le partage sera mort en silence`,
      ).toContain(attendu);
    }
  });
});
